# Phase 14: filter-view-store — Research

**Researched:** 2026-05-06
**Domain:** Frontend Zustand slice + thin client API helpers (pure plumbing — no UI, no caller wiring)
**Confidence:** HIGH

## Summary

Phase 14 ships a new Zustand slice (`useFilterViewStore`) and two thin `apiFetch`-based client helpers (`materializeFilter`, `dropFilterView`) into an existing v1.2 + Phase 13 codebase that already has every supporting primitive in place. There is **zero new dependency**, **zero stack delta**, and **zero new test infrastructure** required. The work is mechanical mirror-and-extend against templates that already exist in-repo: `useDashboardLayersStore` (per-id reference-stable updates), `runSql` (apiFetch + throwForStatus + AbortSignal), and the existing Phase 13 endpoint contract.

The phase is deliberately **dormant code** — `useFilterViewStore` has no production caller in Phase 14. Renderer-side wiring (`AggregatedWidgetRenderer.materializeAbortRef`, FROM-swap, debounce) is migrated to Phase 15 by user lock so DDL is never fired without consumer-side filtering. This research is therefore short on architectural exploration (already locked in CONTEXT.md and the v1.3 research bundle at `.planning/research/`) and long on **exact templates to mirror** so the planner can write surgical, copy-locality plans.

**Primary recommendation:** Mirror `useDashboardLayersStore.updateLayer` (`dashboardLayersStore.ts:36-46`) for per-`tableId` reference-stable mutations and mirror `runSql` (`client.ts:126-143`) for both helpers — same `apiFetch + throwForStatus + signal?: AbortSignal` shape. Don't introduce new patterns. Don't refactor anything. Don't import from `useFilterStore` except the `ActiveFilter` type.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Trigger wiring scope** (user-locked: "Land 14 + 15 atomically"):
- Phase 14 does NOT modify `AggregatedWidgetRenderer`. The store + helpers ship dormant — no caller in production code paths.
- ROADMAP.md Phase 14 success criterion #3 (`AggregatedWidgetRenderer` is the sole trigger / `materializeAbortRef`) **migrates to Phase 15**.
- VSTORE-V13-02 renderer-side dispatch portion **migrates to Phase 15**. The store-side primitive (200-only `setView()`, separate abort handling capability via `signal?` param) IS buildable in Phase 14.
- Rationale: avoids ~1 phase of wasted DDL on every chart click between Phase 14 deploy and Phase 15 deploy.

**Store shape** (locked by VSTORE-V13-01 + reference-stable updates):
- Slice: `useFilterViewStore`. File: `kinetica_bi/src/store/filterViewStore.ts`. Spec: `kinetica_bi/src/store/filterViewStore.spec.ts`.
- Located under `src/store/` so the Zustand reset shim auto-covers it.
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
- **Reference-stable per-table updates** (mirrors `useDashboardLayersStore.updateLayer` at `dashboardLayersStore.ts:36-46`).
- Action semantics: see CONTEXT.md § "Store shape" — semantics are fully locked there. Notably:
  - `markMaterializing` creates entry if missing; preserves prior `viewName`/`expiresAt`/`materializeVersion` if present.
  - `setView` writes entry; sets `materializing: false`; bumps `materializeVersion` on same-name overwrite, initializes `materializeVersion: 1` on new viewName. **Called only after server returns 200** (no optimistic update).
  - `clearView` deletes entry from `views` map (delete-key semantics).
  - `bumpMaterializeVersion` increments existing entry's version; no-op if entry missing.
  - `reset()` empties `views` to `{}`. Internal-only (no App.tsx / DashboardsPage.tsx wiring in Phase 14).

**API helpers** (locked by VSTORE-V13-04 + Phase 13 endpoint contract):
- Both helpers live in `kinetica_bi/src/api/client.ts` alongside `runSql`, `materializeView`, etc.
- Signatures (locked):
  ```ts
  type MaterializeFilterArgs = { dashboardId: number; tableId: number; filters: ActiveFilter[] };
  type MaterializeFilterResponse = { viewName: string; expiresAt: number };
  export const materializeFilter = async (args: MaterializeFilterArgs, signal?: AbortSignal): Promise<MaterializeFilterResponse> => { ... };

  type DropFilterViewArgs = { dashboardId: number; tableId: number };
  type DropFilterViewResponse = { dropped: true };
  export const dropFilterView = async (args: DropFilterViewArgs, signal?: AbortSignal): Promise<DropFilterViewResponse> => { ... };
  ```
- `ActiveFilter` imported from `src/store/filterStore.ts` (existing v1.2 type).
- Implementation pattern: `apiFetch + throwForStatus` (mirrors `runSql` at `client.ts:126-143`). Body is JSON for POST; query string for DELETE.
- AbortSignal threading: identical to `runSql`. Caller (Phase 15) creates the controller; helper threads `signal` into `apiFetch`.
- DELETE fire-and-forget is the CALLER's behavior, not the helper's. Helper awaits and returns `{ dropped: true }` on success; does not silently swallow errors.

**Error UX** (deferred wiring; documented for Phase 15 planner; user-locked: "toast every failure"):
- `useFilterViewStore` does NOT carry an `errorToastShown` field. State stays minimal.
- Phase 15's catch path will toast on `PermissionError` (403) and `UpstreamError` (502); silent on `AbortError`.
- Phase 14 helpers DO NOT swallow errors — they propagate so Phase 15 can decide.

**Reset wiring scope** (user-locked: "Phase 14 ships reset() only"):
- Ship the `reset()` action with full unit-test coverage.
- Phase 14 does NOT modify `App.tsx:42` (logout) or `DashboardsPage.tsx:381` (dashboard-switch).
- LIFE-V13-03 / LIFE-V13-04 stay tagged Phase 15.

**Verification** (user-locked: "Tests only, no integration test in Phase 14"):
- Store unit tests + API helper unit tests.
- No `AggregatedWidgetRenderer` integration test in Phase 14.

### Claude's Discretion

- Exact spec file count and split (one big `filterViewStore.spec.ts` vs split into action-spec / reference-stability-spec).
- Whether helper tests live in a new `client.spec.ts` or colocated `*.spec.ts` per helper.
- Whether `FilterViewEntry` and request/response types are exported from `filterViewStore.ts` or `client.ts` or both.
- Inline pitfall comments referencing PITFALL IDs (V13-P-09, V13-P-10) — match the inline-comment style from `filterStore.ts`.
- Whether the helpers also accept an `AbortController` (not just `AbortSignal`) — pick whichever is more ergonomic; `AbortSignal` matches `runSql`'s existing signature.

### Deferred Ideas (OUT OF SCOPE)

- Renderer-side trigger wiring (`materializeAbortRef`, 300ms debounce, dispatch on `filterVersion` change) → Phase 15
- Toast-on-failure wiring in `AggregatedWidgetRenderer` → Phase 15
- `useFilterViewStore.reset()` integration into App.tsx and DashboardsPage.tsx → Phase 15 (LIFE-V13-03/04)
- Fire-and-forget DROP on logout / dashboard-switch → Phase 15 (LIFE-V13-03/04)
- Once-per-session toast suppression flag → Phase 17 follow-up
- Proactive TTL expiry recovery (`expiresAt` check) → Phase 15 LIFE-V13-01
- Reactive TTL expiry recovery (`isViewNotFoundError` catch + retry) → Phase 15 LIFE-V13-02
- `bumpMaterializeVersion` callers → Phase 15/16 (Phase 14 ships the action; no Phase 14 caller)
- OIDC-mode DDL re-probe (S2.b deferred from Phase 13) → Phase 15 LIFE-V13-02 OR Phase 17
- Phase 16 `_mv` cache-buster sourcing from `useFilterViewStore.materializeVersion[tableId]` → Phase 16
- Map LAYERS-swap (`MAP-V13-*`) → Phase 16
- Dead-code deletion (`injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter`) → Phase 15 (atomic with FROM-swap)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VSTORE-V13-01 | New `useFilterViewStore` Zustand slice with shape `Record<tableId, { viewName, expiresAt, materializing, materializeVersion }>` and actions `setView`, `clearView`, `markMaterializing`, `bumpMaterializeVersion`, `reset`. Reference-stable per-table updates. | Template: `useDashboardLayersStore.updateLayer` at `dashboardLayersStore.ts:36-46` (lines 36-46 — copy idiom). Zustand reset shim at `__mocks__/zustand.ts` auto-covers any `src/store/*.ts` slice via `vi.mock("zustand")` in `src/test/setup.ts`. |
| VSTORE-V13-02 | Materialize call dispatched from `AggregatedWidgetRenderer` ONLY; 300ms debounce; dedicated `materializeAbortRef`; `setView()` only after server confirms 200 (no optimistic updates). | **Renderer-side dispatch migrates to Phase 15** (user lock). Phase 14 ships the store primitive (200-only `setView`, no optimistic write) + helper that accepts `signal?: AbortSignal` so Phase 15 can wire `materializeAbortRef`. |
| VSTORE-V13-03 | `useFilterStore` byte-for-byte unchanged. | Phase 14 must NOT touch `kinetica_bi/src/store/filterStore.ts`. The new helpers IMPORT the existing `ActiveFilter` type from there — read-only consumption. |
| VSTORE-V13-04 | New client API helpers (`materializeFilter`, `dropFilterView`) added to `kinetica_bi/src/api/client.ts` following existing `apiFetch` patterns; `signal?` threaded through. | Templates: `runSql` at `client.ts:126-143` (POST + signal); `deleteDashboard` at `client.ts:182-187` (DELETE pattern). `apiFetch` at `client.ts:36`; `throwForStatus` at `client.ts:61`; `PermissionError`/`UpstreamError` at `client.ts:7-32`. |

## Standard Stack

### Core (zero new dependencies — Phase 14 stack is fully present in repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 4.5.2 (in `kinetica_bi/package.json`) | Per-tableId view-name state slice | Already used by `useFilterStore`, `useAuthStore`, `useDashboardLayersStore`, `useToastStore`, `useWmsCapabilitiesStore`. Reset shim already wired. |
| vitest | 4.1.5 (in `kinetica_bi/package.json`) | Store + helper unit tests | Already configured (`vitest.config.ts`); `vi.mock("zustand")` already in `src/test/setup.ts`. |
| @testing-library/react | 16.3.2 | `act()` import inside the Zustand reset shim | Already present; do not import directly in Phase 14 specs (no rendering). |

**Version verification:**
```bash
npm view zustand version  # → 5.0.13 (ecosystem latest as of 2026-05-06)
                           # repo pinned to ^4.5.2 — DO NOT UPGRADE in Phase 14.
                           # Zustand v5 has breaking changes (no auto-context selector subscription
                           # behavior diff with React 18 strict-mode and removed deprecated `setState` 3-arg form).
                           # Reset shim is wired against v4 internals; v5 upgrade is its own phase.
```

**Confidence:** HIGH — all stack pieces are already imported and used elsewhere in `src/store/*.ts`. No npm install needed.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | Phase 14 introduces zero new packages | All needed primitives exist. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand `create<T>((set) => ({...}))` | Zustand `create<T>()(immer((set) => ({...})))` | Immer would simplify the reference-stable update at the cost of a new dependency and a divergence from the four other stores in `src/store/` — none of which use immer. **Rejected** — codebase consistency wins; the manual `{ ...state, [tableId]: ... }` idiom is already established in `dashboardLayersStore.ts:36-46`. |
| Two helpers in `client.ts` | New file `src/api/filterClient.ts` | New file is gratuitous separation. `client.ts` is the single client-side network module by convention (locked in CONTEXT.md). **Rejected**. |
| `materializeFilter(args, controller?)` (AbortController) | `materializeFilter(args, signal?)` (AbortSignal) | AbortSignal matches `runSql`'s signature at `client.ts:126-143` exactly. AbortController is more ergonomic at the call site (caller may want to inspect `controller.signal.aborted`) but `AbortSignal` is the conventional fetch-API pattern. **Recommend AbortSignal** for consistency. (Discretion item per CONTEXT.md.) |
| Helper tests in new `client.spec.ts` | Helper tests in `filterViewStore.spec.ts` | `filterViewStore.spec.ts` should stay store-only. A new `client.spec.ts` is a clean home — though there's no precedent. Alternative: colocated `materializeFilter.spec.ts` in `src/api/`. **Recommend new `client.spec.ts`** — gives Phase 15+ a place to add more helper tests without explosion. (Discretion item per CONTEXT.md.) |

**Installation:** None.

## Architecture Patterns

### Recommended File Layout

```
kinetica_bi/src/store/
├── filterViewStore.ts        # NEW — useFilterViewStore slice + FilterViewEntry/FilterViewState types
├── filterViewStore.spec.ts   # NEW — store unit tests
├── filterStore.ts            # UNCHANGED (VSTORE-V13-03 lock)
├── filterStore.spec.ts       # UNCHANGED
├── dashboardLayersStore.ts   # READ-ONLY reference (template for ref-stable updates)
├── auth.ts, toast.ts, ...    # UNCHANGED

kinetica_bi/src/api/
├── client.ts                 # MODIFIED — append materializeFilter, dropFilterView; export types
├── client.spec.ts            # NEW — helper unit tests with mocked fetch
```

**Note:** `client.spec.ts` does not exist yet. Vitest's auto-discovery glob `src/**/*.spec.{ts,tsx}` (per `vitest.config.ts`) will pick it up automatically.

### Pattern 1: Per-id Reference-Stable Update (mirror `dashboardLayersStore`)

**What:** When mutating one entry in a `Record<id, X>` map, only that entry gets a new object reference; all others retain their reference identity. Selector-driven widgets that subscribe to `views[tableId]` for a different table do not re-render.

**When to use:** Every action in `useFilterViewStore` that touches a single `tableId`'s entry — `setView`, `markMaterializing`, `clearView`, `bumpMaterializeVersion`.

**Reference example** (from `kinetica_bi/src/store/dashboardLayersStore.ts:36-46`):
```typescript
// Source: kinetica_bi/src/store/dashboardLayersStore.ts:36-46 (lines 36-46)
updateLayer: (id, patch) =>
  set((state) => {
    // Reference-stable update: only the matching layer is recreated.
    // Layers with other ids keep their object reference intact so React.memo
    // selectors downstream do not re-render the whole list.
    const idx = state.layers.findIndex((l) => l.id === id);
    if (idx < 0) return state; // no-op for unknown id
    const next = state.layers.slice();
    next[idx] = { ...next[idx], ...patch };
    return { layers: next };
  }),
```

**Adaptation for `Record<tableId, FilterViewEntry>` (Phase 14)** — sketch:
```typescript
setView: (tableId, { viewName, expiresAt }) =>
  set((state) => {
    const prev = state.views[tableId];
    const sameName = prev?.viewName === viewName;
    const nextEntry: FilterViewEntry = {
      viewName,
      expiresAt,
      materializing: false,
      materializeVersion: sameName ? prev!.materializeVersion + 1 : 1,
    };
    // Reference-stable: only views[tableId] entry is new; other tableId entries keep their refs.
    return { views: { ...state.views, [tableId]: nextEntry } };
  }),

clearView: (tableId) =>
  set((state) => {
    if (!(tableId in state.views)) return state; // no-op (no version bump on absent key)
    const next = { ...state.views };
    delete next[tableId]; // delete-key semantics — mirrors filterStore.clearFilters at filterStore.ts:91-92
    return { views: next };
  }),
```

### Pattern 2: `apiFetch` + `throwForStatus` Helper (mirror `runSql`)

**What:** Standard credentialed `fetch` wrapper that auto-dispatches `UNAUTHORIZED_EVENT` on 401 with `code: REAUTH_REQUIRED`, returns the raw `Response`, then `throwForStatus` peeks the body for `{ error: string }` and throws `ReauthRequiredError` (401) / `PermissionError` (403) / `UpstreamError` (502) / generic `Error` otherwise.

**When to use:** Every helper that calls a `requireConfig` or `requireAuth` route. Both `materializeFilter` and `dropFilterView` are under the auth namespace per Phase 13 endpoint contract.

**Reference example** (from `kinetica_bi/src/api/client.ts:126-143`):
```typescript
// Source: kinetica_bi/src/api/client.ts:126-143
export const runSql = async <T = unknown>(
  sql: string,
  options?: Record<string, unknown>,
  signal?: AbortSignal // Phase 9 FILT-02: additive — AbortController wiring in AggregatedWidgetRenderer
): Promise<T> => {
  const response = await apiFetch(`${API_BASE}/api/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, options }),
    signal
  });

  if (!response.ok) {
    await throwForStatus(response, "SQL request failed");
  }

  return response.json() as Promise<T>;
};
```

**Adaptation for `materializeFilter` (Phase 14)** — sketch:
```typescript
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

**Adaptation for `dropFilterView`** — DELETE with query string (matches Phase 13 endpoint contract `req.query.dashboardId` + `req.query.tableId` at `server/src/index.ts:706-712`):
```typescript
export const dropFilterView = async (
  args: DropFilterViewArgs,
  signal?: AbortSignal
): Promise<DropFilterViewResponse> => {
  const qs = `?dashboardId=${args.dashboardId}&tableId=${args.tableId}`;
  const response = await apiFetch(`${API_BASE}/api/filter/materialize${qs}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) {
    await throwForStatus(response, "Failed to drop filter view");
  }
  return response.json() as Promise<DropFilterViewResponse>;
};
```

### Pattern 3: Zustand Reset Shim Coverage (canary test)

**What:** Any `create<T>(...)` slice located under `kinetica_bi/src/store/*.ts` is auto-registered with the reset shim at `kinetica_bi/__mocks__/zustand.ts` (activated via `vi.mock("zustand")` in `kinetica_bi/src/test/setup.ts`). The shim resets each store to its initial state in `afterEach` — no per-test cleanup needed.

**Verification:** Add a canary test in `filterViewStore.spec.ts` to confirm the shim covers it (mirrors the canary in `filterStore.spec.ts:18-32`).

**Reference example** (from `kinetica_bi/src/store/filterStore.spec.ts:18-32`):
```typescript
// Source: kinetica_bi/src/store/filterStore.spec.ts:18-32
describe("useFilterStore — canary (PITFALL S-03 — Zustand shim must be active)", () => {
  it("store is empty at start of each test", () => {
    const { filters, filterVersion } = useFilterStore.getState();
    expect(Object.keys(filters)).toHaveLength(0);
    expect(filterVersion).toBe(0);
  });

  it("store is empty at start of each test (run 2 — proves shim resets between tests)", () => {
    const { filters, filterVersion } = useFilterStore.getState();
    expect(Object.keys(filters)).toHaveLength(0);
    expect(filterVersion).toBe(0);
  });
});
```

### Pattern 4: Mocking the API Client Module (helper-as-mock pattern)

**What:** Tests that exercise the helpers themselves should mock the global `fetch`. Tests that exercise components/stores that USE the helpers should mock the helper at the module level via `vi.mock("../api/client", () => ({ ... }))`.

**Reference for module-level helper mock** (from `kinetica_bi/src/store/wmsCapabilities.spec.ts:21-28`):
```typescript
// Source: kinetica_bi/src/store/wmsCapabilities.spec.ts:21-28
vi.mock("../api/client", () => ({
  fetchWmsCapabilities: vi.fn(),
  apiFetch: vi.fn(),
}));
import { fetchWmsCapabilities } from "../api/client";
```

**Reference for `auth.spec.ts` partial-module mock** (from `kinetica_bi/src/store/auth.spec.ts:7-23`) — useful when the spec needs a few helpers mocked but the rest re-imported.

**For helper tests in `client.spec.ts`** — direct global fetch mock per test:
```typescript
// Sketch — client.spec.ts (NEW file)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { materializeFilter, dropFilterView, PermissionError, UpstreamError } from "./client";

describe("materializeFilter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("POSTs JSON body with credentials and threads signal", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ viewName: "_kbi_filt_u1_d2_t3_sabcdefab", expiresAt: 1234567890 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const controller = new AbortController();
    const result = await materializeFilter(
      { dashboardId: 2, tableId: 3, filters: [{ column: "x", value: 1, dataType: "number", addedAt: 0 }] },
      controller.signal
    );
    expect(result).toEqual({ viewName: "_kbi_filt_u1_d2_t3_sabcdefab", expiresAt: 1234567890 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/api\/filter\/materialize$/);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    });
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      dashboardId: 2,
      tableId: 3,
    });
  });

  it("throws PermissionError on 403 with server-provided message", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "DDL permission denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      materializeFilter({ dashboardId: 1, tableId: 1, filters: [{ column: "x", value: 1, dataType: "number", addedAt: 0 }] })
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("throws UpstreamError on 502", async () => { /* ... */ });
  it("propagates AbortError when signal is aborted before response", async () => { /* ... */ });
});

describe("dropFilterView", () => {
  it("DELETEs with dashboardId+tableId query string", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ dropped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await dropFilterView({ dashboardId: 2, tableId: 3 });
    expect(result).toEqual({ dropped: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/filter\/materialize\?dashboardId=2&tableId=3$/);
    expect(init).toMatchObject({ method: "DELETE", credentials: "include" });
  });
});
```

### Anti-Patterns to Avoid

- **Optimistic store update before server confirms (V13-P-01).** Never write `useFilterViewStore.setView(...)` before the `materializeFilter(...)` promise resolves. Phase 14 lock: `setView` is the post-200 path; `markMaterializing` is the pre-call path. Documented in inline comment.
- **Sharing AbortController across materialize and chart-query (V13-P-10).** Phase 14 doesn't own the trigger; Phase 15 will. But the helper signature MUST allow caller-supplied `AbortSignal` so Phase 15 can wire a separate `materializeAbortRef`.
- **Reading the WHOLE `views` map in a hot widget selector.** Document in inline comment that callers must scope selectors to `views[tableId]` (mirrors C-02 lock from `WidgetRenderer.tsx:213-218`). No Phase 14 caller exists, but the comment guards Phase 15+ implementations.
- **Deep-cloning the entire `views` map on every action.** The reference-stable pattern only spreads the top level; the unchanged entries keep their refs. Doing `structuredClone(state.views)` would defeat selector-driven re-render scoping.
- **Importing anything from `useFilterStore` other than `ActiveFilter` type.** VSTORE-V13-03 lock: `filterStore.ts` is byte-for-byte unchanged. Type-only import is fine; reading state from it inside the new store is forbidden (the two stores intentionally do NOT share state).
- **Adding a new file under `src/api/` for the helpers.** CONTEXT.md locked: helpers go in `client.ts` alongside `runSql`, `materializeView`, etc.
- **Throwing custom `MaterializeError` / `DropError` classes.** `throwForStatus` already returns `PermissionError` / `UpstreamError` / `ReauthRequiredError` — Phase 15's catch path uses `instanceof` against these. Adding custom subclasses fragments the error model.
- **Calling `apiFetch` without `credentials: "include"`.** `apiFetch` already injects this at `client.ts:37` — use `apiFetch`, not raw `fetch`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Credentialed fetch with auth-event dispatch on 401 | Custom `fetch` wrapper that re-implements UNAUTHORIZED_EVENT plumbing | `apiFetch` from `client.ts:36` | Already implements credential threading + 401 body-peek + `UNAUTHORIZED_EVENT` dispatch. Re-implementing creates two diverging codepaths. |
| HTTP status → typed error mapping | Custom `if (response.status === 403) throw ...` blocks | `throwForStatus(response, fallbackMsg)` from `client.ts:61` | Already maps 401/403/502 to `ReauthRequiredError`/`PermissionError`/`UpstreamError`. Already handles `{ error: string }` body extraction. Phase 15's catch path depends on these specific error classes — bypassing breaks the `instanceof` chain. |
| Zustand store reset between tests | Manual `beforeEach(() => useFilterViewStore.setState(...))` | The existing reset shim at `__mocks__/zustand.ts` (auto-active via `vi.mock("zustand")` in `src/test/setup.ts`) | Auto-covers any `create<T>()(stateCreator)` in `src/**/*.ts`. Manual reset duplicates infrastructure; `auth.ts`/`filterStore.ts`/`dashboardLayersStore.ts` all rely on it. |
| Per-tableId reference-stable update | Hand-built `_.cloneDeep` or per-action immer setup | The spread-and-replace idiom from `dashboardLayersStore.ts:36-46` | Already idiomatic; matches the four other stores; selector-friendly without immer. |
| `ActiveFilter` type duplication | New `FilterPayload` type in `filterViewStore.ts` | Import `ActiveFilter` from `src/store/filterStore.ts` | Single source of truth. The server-side duplication in `whereClause.ts` is deliberate (server is frontend-import-free). The client has one canonical type. |
| AbortSignal threading | Custom `if (controller.signal.aborted) throw ...` | Native `fetch(url, { signal })` — propagates as `AbortError` automatically | The Fetch spec handles abort propagation. `AbortError` is detected via `err?.name === "AbortError"` (matches `WidgetRenderer.tsx:243`); helpers don't need explicit handling. |
| Endpoint URL composition for DELETE query string | URLSearchParams + URL builder | Inline template literal (matches `client.ts:184` pattern for `deleteDashboard`) | Single dashboardId+tableId — template literal is shorter and self-documenting; matches existing convention. |
| Date.now() / TTL math | Custom expiry tracking | Server returns `expiresAt` in the response — store it as-is | Phase 13 endpoint already computes `Date.now() + 5 * 60 * 1000` server-side at `server/src/index.ts:702`. Client trusts server timestamp; no clock-skew handling needed for v1.3 internal tool. Phase 15 will compare `Date.now() >= expiresAt` for proactive recovery. |

**Key insight:** Phase 14 is a "compose existing primitives" phase, not a "build new primitives" phase. The strongest plan is one that explicitly says "copy lines X-Y from `dashboardLayersStore.ts`, paste into `filterViewStore.ts`, adapt the type signatures." Plans that introduce new utility functions or abstractions are over-engineering for a 4-action store + two thin helpers (~120 LOC total estimated).

## Common Pitfalls

### Pitfall 1: Optimistic Store Update (V13-P-01 carry-forward)

**What goes wrong:** Future Phase 15 caller writes `useFilterViewStore.setView(...)` before the materialize POST resolves. Widgets re-render, query the not-yet-existent view, get a 400 error from Kinetica, flash error UI for 50-300ms.

**Why it happens:** "Optimistic" updates are an attractive React pattern for low-latency UX. But the view name is meaningless until Kinetica's DDL completes — the optimism is over server-side state, not local state.

**How to avoid:** `setView` is documented (inline comment + RESEARCH.md + planner instruction) as the **post-200-only** action. The pre-call action is `markMaterializing(tableId)` which sets the flag without writing a view name. Phase 15 wires: `markMaterializing → await materializeFilter → setView`. Phase 14's job is to make `setView` semantically the post-200 write so Phase 15 can't easily get it wrong.

**Warning signs:**
- Inline comments in `filterViewStore.ts` use `setView` without the "post-200 only" guard documentation.
- Phase 15 plan suggests "call `setView` immediately, retry on error" — that path is forbidden.

### Pitfall 2: Out-of-Order Materialize Response (V13-P-02 carry-forward)

**What goes wrong:** Two materialize calls in flight (rapid filter clicks). The second succeeds, then the first response arrives — frontend stores the older view name, while Kinetica's view content reflects the newer filter.

**Why it happens:** Without a separate AbortController for materialize calls, only the chart-query controller cancels — the materialize keeps going.

**How to avoid:** The `materializeFilter(args, signal?)` signature accepts `AbortSignal` — Phase 15 wires a dedicated `materializeAbortRef.current.abort()` before each new call. Phase 14's contribution: helper signature is locked to accept `signal?`, mirrors `runSql`, and the helper passes `signal` straight to `apiFetch` / `fetch` so caller-side abort works as expected.

**Warning signs:**
- Helper signature drops `signal?` ("we don't need it in Phase 14") — would force Phase 15 to refactor the helper.
- Helper accepts `signal?` but doesn't pass it to `apiFetch` (silent drop) — ensure the spec test asserts `init.signal === controller.signal`.

### Pitfall 3: Zustand Reset Shim Skipped (V13-P-S2 carry-forward, S-03 from v1.2)

**What goes wrong:** `useFilterViewStore` lives in a path the shim doesn't auto-cover (e.g., `src/lib/` instead of `src/store/`), or the spec file lives somewhere `vi.mock("zustand")` doesn't apply, or the spec uses `vi.unmock("zustand")` somewhere. Test runs see state bleed: test N's mutations are visible to test N+1.

**Why it happens:** The shim wires up via `vi.mock("zustand")` in `src/test/setup.ts` — file location matters because the mock applies based on Vitest's setupFile registration, not store location. But the canonical location is `src/store/*.ts` for all five existing stores; deviating from that is asking for trouble.

**How to avoid:**
- Place `filterViewStore.ts` at exactly `kinetica_bi/src/store/filterViewStore.ts` (per CONTEXT.md lock).
- Place spec at `kinetica_bi/src/store/filterViewStore.spec.ts` (per CONTEXT.md lock).
- Add the canary test (Pattern 3 above) — two consecutive `it("starts empty")` blocks. If the shim isn't covering the store, the second block fails after any prior test mutates state.
- Add inline doc comment "auto-covered by Zustand reset shim" matching `dashboardLayersStore.ts:13-15`.

**Warning signs:**
- Spec runs green individually but fails when the full suite runs (order-dependent failures).
- The two canary tests pass in isolation but the second fails when ANY mutation test runs before it.

### Pitfall 4: ActiveFilter Type Drift Between Client and Server

**What goes wrong:** Server's `ActiveFilter` (in `server/src/lib/whereClause.ts:35-42`) is intentionally duplicated from the client's (in `src/store/filterStore.ts:14-20`) so the server module stays frontend-import-free. If a future change adds a field to one and not the other, the helper sends a body the server can't parse (or vice versa).

**Why it happens:** Two declarations of the same shape — drift is easy.

**How to avoid:**
- Phase 14 imports `ActiveFilter` from `src/store/filterStore.ts` for the helper's type signature. **No new client-side declaration.**
- Phase 14 RESEARCH.md / plan calls out the duplication explicitly so future maintainers see the contract.
- If a Phase 15+ change adds a field to `ActiveFilter`, both declarations must update atomically. Document this lock in inline comment near the helper's `MaterializeFilterArgs` type.

**Warning signs:**
- Plan suggests "redeclare ActiveFilter inside `client.ts`" — reject.
- Plan suggests "import ActiveFilter from server/src/lib" — wrong direction; server doesn't ship to client. Always client → server type re-use.

### Pitfall 5: Test File Discovery Mismatch

**What goes wrong:** Vitest config glob is `src/**/*.spec.{ts,tsx}` (per `vitest.config.ts:9`). A spec placed elsewhere (e.g., `kinetica_bi/__tests__/...` or `kinetica_bi/test/...`) is silently ignored.

**Why it happens:** Vitest doesn't error on un-matched specs — they just don't run.

**How to avoid:** All Phase 14 specs go under `kinetica_bi/src/`. Confirmed valid locations:
- `kinetica_bi/src/store/filterViewStore.spec.ts` ✅
- `kinetica_bi/src/api/client.spec.ts` ✅

**Warning signs:** Plan places a spec under `kinetica_bi/tests/` or `kinetica_bi/__tests__/` — wrong, won't run.

### Pitfall 6: Multi-Tab Last-Write-Wins (V13-P-09 — accepted, document only)

**What goes wrong:** User opens same dashboard in two browser tabs (same session cookie). Both tabs filter the same table → both compute the same view name (deterministic per `userId+sessionId+dashboardId+tableId`) → second tab's `CREATE OR REPLACE` silently overwrites first tab's view content. Tab 1's filter bar shows filter A; Tab 1's charts show data filtered by Tab 2's filter B.

**Why it happens:** View name is intentionally deterministic for idempotency. Multi-tab use of one BI session was not in v1.3 design scope.

**How to avoid:** Phase 14 inline-comments this in `filterViewStore.ts` near the type definition with a `// V13-P-09 lock: ...` reference. No code fix needed for v1.3 (accepted trade-off per CONTEXT.md). Future v1.4 mitigation: add a per-tab `crypto.randomUUID()` to the view name input — implementable without server changes.

**Warning signs:** None at Phase 14 since there's no Phase 14 caller. Phase 15 might surface this in QA — Phase 14's job is to leave a comment trail.

### Pitfall 7: `fetch` global vs `globalThis.fetch` mocking ergonomics

**What goes wrong:** `vi.spyOn(global, "fetch")` works in Node but is brittle in jsdom (jsdom 29 binds `fetch` to `window` and `globalThis`). `vi.fn()` replacement of `globalThis.fetch` works in both.

**Why it happens:** jsdom's polyfill wiring of fetch onto various roots.

**How to avoid:**
- Use `vi.spyOn(globalThis, "fetch")` consistently (works in jsdom 29 per `kinetica_bi/package.json`).
- Restore in `afterEach` via `fetchSpy.mockRestore()`.
- Mirror the pattern from any existing fetch-mocking spec — closest reference is the partial-mock pattern in `auth.spec.ts:7-13` (mocking `client.ts` exports, not raw fetch). For raw-fetch pattern, the planner picks: `vi.spyOn(globalThis, "fetch")` with `mockResolvedValueOnce(new Response(...))`.

**Warning signs:** Spec runs green locally but fails in CI with "fetch is not defined" — usually a sign the mock spies on `global` instead of `globalThis`.

### Pitfall 8: DELETE Body Not Empty / GET-on-DELETE — Phase 13 Endpoint Contract

**What goes wrong:** Phase 13 endpoint expects `DELETE /api/filter/materialize?dashboardId=N&tableId=M` (query string, no body). If the helper sends a body or uses POST instead of DELETE, the endpoint returns 400.

**Why it happens:** Easy to confuse REST verbs when adapting from POST template.

**How to avoid:** Spec test asserts:
- HTTP method is `DELETE`
- URL contains `?dashboardId=N&tableId=M` (exact format — server uses `Number(req.query.dashboardId)` at `server/src/index.ts:707`)
- No body in the fetch init (or `body` is `undefined`)
- `credentials: "include"` is set (via `apiFetch`)

**Warning signs:** Server logs show 400 on DELETE — usually the URL format is wrong or method is POST.

## Code Examples

Verified patterns from in-repo sources. Plans should reference these line numbers directly.

### Example 1: Per-id Reference-Stable Update Idiom

```typescript
// Source: kinetica_bi/src/store/dashboardLayersStore.ts:36-46
updateLayer: (id, patch) =>
  set((state) => {
    // Reference-stable update: only the matching layer is recreated.
    // Layers with other ids keep their object reference intact so React.memo
    // selectors downstream do not re-render the whole list.
    const idx = state.layers.findIndex((l) => l.id === id);
    if (idx < 0) return state; // no-op for unknown id
    const next = state.layers.slice();
    next[idx] = { ...next[idx], ...patch };
    return { layers: next };
  }),
```

### Example 2: Delete-Key Semantics (mirror clearFilters)

```typescript
// Source: kinetica_bi/src/store/filterStore.ts:87-97
clearFilters: (tableId) =>
  set((state) => {
    const existing = state.filters[tableId] ?? [];
    if (existing.length === 0) return state; // nothing to clear — no version bump
    const next = { ...state.filters };
    delete next[tableId]; // PITFALL S-02: deletion semantics — empty key vs absent key both selector-safe
    return {
      filters: next,
      filterVersion: state.filterVersion + 1,
    };
  }),
```

### Example 3: AbortSignal-Threading POST Helper

```typescript
// Source: kinetica_bi/src/api/client.ts:126-143
export const runSql = async <T = unknown>(
  sql: string,
  options?: Record<string, unknown>,
  signal?: AbortSignal // Phase 9 FILT-02: additive — AbortController wiring in AggregatedWidgetRenderer
): Promise<T> => {
  const response = await apiFetch(`${API_BASE}/api/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, options }),
    signal
  });

  if (!response.ok) {
    await throwForStatus(response, "SQL request failed");
  }

  return response.json() as Promise<T>;
};
```

### Example 4: DELETE Helper (no body, status 204 acceptable)

```typescript
// Source: kinetica_bi/src/api/client.ts:182-187
export const deleteDashboard = async (id: number): Promise<void> => {
  const response = await apiFetch(`${API_BASE}/api/dashboards/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    await throwForStatus(response, "Failed to delete dashboard");
  }
};
```

**Note for Phase 14:** the Phase 13 DELETE endpoint returns 200 with `{ dropped: true }` (per `server/src/index.ts:727`), NOT 204. The `dropFilterView` helper should NOT use the `status !== 204` short-circuit — instead, treat 200 as the success path and parse JSON.

### Example 5: Zustand Store Spec Canary

```typescript
// Source: kinetica_bi/src/store/dashboardLayersStore.spec.ts:18-19
it("starts empty (Zustand reset shim canary)", () => {
  expect(useDashboardLayersStore.getState().layers).toEqual([]);
});
```

### Example 6: Reference-Identity Assertion

```typescript
// Source: kinetica_bi/src/store/dashboardLayersStore.spec.ts:41-50
it("updateLayer preserves reference identity for unmodified layers", () => {
  const a = mk(1), b = mk(2), c = mk(3);
  useDashboardLayersStore.getState().setLayers([a, b, c]);
  const before = useDashboardLayersStore.getState().layers;
  useDashboardLayersStore.getState().updateLayer(2, { position: 99 });
  const after = useDashboardLayersStore.getState().layers;
  expect(after[0]).toBe(before[0]); // layer 1 reference unchanged
  expect(after[2]).toBe(before[2]); // layer 3 reference unchanged
  expect(after[1]).not.toBe(before[1]); // layer 2 reference changed
});
```

**Adapt for `filterViewStore`:**
```typescript
// Sketch:
it("setView preserves reference identity for entries on other tableIds", () => {
  useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1", expiresAt: 1000 });
  useFilterViewStore.getState().setView(2, { viewName: "_kbi_filt_v2", expiresAt: 2000 });
  const before = useFilterViewStore.getState().views;
  useFilterViewStore.getState().setView(1, { viewName: "_kbi_filt_v1_new", expiresAt: 3000 });
  const after = useFilterViewStore.getState().views;
  expect(after[2]).toBe(before[2]); // tableId=2 entry unchanged
  expect(after[1]).not.toBe(before[1]); // tableId=1 entry replaced
});
```

### Example 7: Module-Level API Mock (alternate test strategy)

```typescript
// Source: kinetica_bi/src/store/auth.spec.ts:7-23
vi.mock("../api/client", () => ({
  fetchAuthConfig: vi.fn(),
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

import { fetchAuthConfig, fetchMe } from "../api/client";

const fetchAuthConfigMock = fetchAuthConfig as unknown as ReturnType<typeof vi.fn>;
const fetchMeMock = fetchMe as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchAuthConfigMock.mockReset();
  fetchMeMock.mockReset();
});
```

**Phase 14 application:** Not needed for the store spec (the store has zero side effects beyond `set`). May be needed for any Phase 15+ component spec that exercises the materialize trigger — out of scope for Phase 14.

## State of the Art

| Old Approach (v1.2) | Current Approach (v1.3) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side `injectWhereClause` + `buildWhereClause` mutating widget SQL | Server-side `CREATE OR REPLACE MATERIALIZED VIEW` + client-side FROM-swap | v1.3 (Phase 13 ships endpoint; Phase 15 swaps consumers; Phase 16 swaps WMS LAYERS) | Filtering now uniformly works across charts AND map tiles (closes TD-V12-01); centralizes SQL safety server-side. **Phase 14:** ships the store + helpers that Phase 15+ consume. |
| `useFilterStore` carries WHERE clause + chip state | Two-store split: `useFilterStore` (chips, filterVersion, 10-cap) + `useFilterViewStore` (view name, expiresAt, materializing, materializeVersion) per tableId | Phase 14 introduces the second store | Cleaner separation of WHEN-to-materialize (filterStore) vs WHAT-NAME-to-FROM (filterViewStore); selector scoping per tableId reduces re-renders. |
| WMS `_v` cache-buster sourced from `filterStore.filterVersion` | WMS `_mv` cache-buster sourced from `useFilterViewStore.views[tableId].materializeVersion` | Phase 16 (Phase 14 ships the field; Phase 16 wires the consumer) | Cache-bust fires only on actual materialize completion, not on every filterStore mutation. Reduces redundant WMS tile fetches. |

**Deprecated/outdated** (will be removed atomically with FROM-swap landing in Phase 15 — NOT Phase 14):
- `injectWhereClause`, `buildWhereClause`, `escapeKineticaStringLiteral`, `buildEqualityFilter` from `filterStore.ts` (FILT-V13-05)
- WMS `QUERY` / `FILTER_PARAM` block in `wmsUrlBuilder.ts` (MAP-V13-03)

## Open Questions

1. **Helper test colocation: new `client.spec.ts` vs colocated `*.spec.ts` per helper?**
   - What we know: `client.ts` has no existing spec file; vitest auto-discovers `src/**/*.spec.{ts,tsx}`; the file would house future Phase 15+ helper tests too.
   - What's unclear: Whether to commit to `client.spec.ts` (one big file) or `materializeFilter.spec.ts` + `dropFilterView.spec.ts` (per-helper).
   - Recommendation: **Single `client.spec.ts`**. Fewer files; matches the single-`client.ts` source convention. If the file grows past ~500 LOC, split later. (Discretion item per CONTEXT.md.)

2. **`AbortSignal` vs `AbortController` for the helper's second arg?**
   - What we know: `runSql` takes `signal?: AbortSignal` (the standard fetch-API pattern). `AbortController` would let the caller `controller.abort()` after the call (uncommon pattern).
   - What's unclear: Slight ergonomic difference for Phase 15 callers.
   - Recommendation: **`AbortSignal`** for symmetry with `runSql`. Caller creates `new AbortController()` and passes `controller.signal`. (Discretion item per CONTEXT.md; pre-locked in CONTEXT.md effectively.)

3. **Where to export `FilterViewEntry` and the `MaterializeFilterArgs/Response` / `DropFilterViewArgs/Response` types?**
   - What we know: `FilterViewEntry` is store-internal but callers (Phase 15 selectors) need it. The args/response types are helper-internal but tests need them.
   - What's unclear: One file vs both vs only the store file.
   - Recommendation: Export `FilterViewEntry` and `FilterViewState` from `filterViewStore.ts`. Export `MaterializeFilterArgs`, `MaterializeFilterResponse`, `DropFilterViewArgs`, `DropFilterViewResponse` from `client.ts` (alongside the helper functions). Avoids a circular import; matches `client.ts`'s existing pattern of exporting types for each helper (`DashboardDto`, `WidgetDto`, etc.). (Discretion item per CONTEXT.md.)

4. **OIDC re-probe (S2.b deferred from Phase 13) is still open. Does Phase 14 surface it?**
   - What we know: Phase 13 spike (S2.b) couldn't probe OIDC-mode DDL permission because no OIDC token reachable. STATE.md tags this for Phase 15 LIFE-V13-02 OR Phase 17.
   - What's unclear: Whether Phase 14 has any vector to surface the issue.
   - Recommendation: **No.** Phase 14 has zero production caller — no DDL fires from Phase 14 code. The first Phase 14 caller is the test suite (mocked fetch). OIDC re-probe stays Phase 15/17. Out of scope.

## Sources

### Primary (HIGH confidence)
- `kinetica_bi/src/store/dashboardLayersStore.ts:36-46` — Reference-stable per-id update template
- `kinetica_bi/src/store/dashboardLayersStore.spec.ts:18-77` — Spec pattern with canary + ref-identity assertions
- `kinetica_bi/src/store/filterStore.ts:33-102` — Zustand template + `ActiveFilter` type + delete-key semantics
- `kinetica_bi/src/store/filterStore.spec.ts:18-160` — Canary pattern + comprehensive action test layout
- `kinetica_bi/src/api/client.ts:7-32` — `ReauthRequiredError`, `PermissionError`, `UpstreamError` classes
- `kinetica_bi/src/api/client.ts:36-77` — `apiFetch` + `throwForStatus` reference implementation
- `kinetica_bi/src/api/client.ts:126-143` — `runSql` (POST + AbortSignal template)
- `kinetica_bi/src/api/client.ts:182-187` — `deleteDashboard` (DELETE template)
- `kinetica_bi/src/api/client.ts:419-425` — `materializeView` (v1.0 materialize-style helper for context)
- `kinetica_bi/__mocks__/zustand.ts` — Reset-shim implementation
- `kinetica_bi/src/test/setup.ts` — `vi.mock("zustand")` activation + `afterEach` cleanup
- `kinetica_bi/vitest.config.ts` — Test discovery glob (`src/**/*.spec.{ts,tsx}`)
- `kinetica_bi/server/src/index.ts:667-728` — Phase 13 endpoint contract (POST + DELETE)
- `kinetica_bi/server/src/lib/whereClause.ts:35-42` — Server-side `ActiveFilter` shape (frontend-import-free duplication)
- `.planning/phases/14-filter-view-store/14-CONTEXT.md` — All locked decisions, scope tightening, discretion items
- `.planning/REQUIREMENTS.md § Client View State Store` — VSTORE-V13-01..04 specs
- `.planning/STATE.md` — Phase 13 endpoint contract lock; spike findings; OIDC re-probe carry-forward
- `.planning/research/PITFALLS.md` — V13-P-01, V13-P-02, V13-P-09, V13-P-S2/S-03 (all relevant to Phase 14)
- `.planning/codebase/CONVENTIONS.md` — TS strict, camelCase, 2-space, no path aliases, no formatter

### Secondary (MEDIUM confidence)
- `kinetica_bi/src/store/auth.spec.ts:7-23` — Module-level mock pattern (alternate strategy for component-style tests)
- `kinetica_bi/src/store/wmsCapabilities.spec.ts:21-28` — Same mock pattern + per-test reset
- [Zustand Testing Guide](https://github.com/pmndrs/zustand/blob/HEAD/docs/learn/guides/testing.md) — Reset-shim source pattern referenced at top of `__mocks__/zustand.ts`
- `kinetica_bi/package.json` — Pinned versions; `zustand: ^4.5.2`, `vitest: ^4.1.5`, `jsdom: ^29.1.1`

### Tertiary (LOW confidence — no Phase 14 dependency)
- npm view `zustand@5.0.13` — ecosystem latest; not relevant for Phase 14 (repo pinned to v4)
- Kinetica TTL / DDL syntax docs — already validated by Phase 13 spikes; Phase 14 doesn't issue DDL

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every dependency is already in `package.json` and used by existing stores. Zero install needed.
- Architecture / patterns: **HIGH** — direct templates exist in-repo (`dashboardLayersStore.ts`, `runSql`, `filterStore.spec.ts`). Plans copy line-by-line.
- API contract (Phase 13 inheritance): **HIGH** — endpoint contract locked at STATE.md and verified by reading `server/src/index.ts:667-728`.
- Pitfalls: **HIGH** — pitfalls research file (`.planning/research/PITFALLS.md`) documented during Phase 13; carry-forward items (V13-P-01, V13-P-02, V13-P-09) apply unchanged.
- Discretion items: **MEDIUM** — three small choices remain (single vs split spec; AbortSignal vs Controller; type export location). All low-risk; documented above with recommendations.

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (30 days for stable research; refresh if Phase 14 starts after that date or if `package.json` deps change in the interim)
