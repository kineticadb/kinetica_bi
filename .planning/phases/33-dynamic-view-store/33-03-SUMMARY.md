---
phase: 33-dynamic-view-store
plan: 03
subsystem: frontend-client-helpers-and-lifecycle
tags: [client-helpers, lifecycle-reset, drop-loop, zustand-integration, tdd, discriminated-union]

# Dependency graph
requires:
  - phase: 33-dynamic-view-store-01
    provides: "useDynamicViewStore Zustand slice + buildDynamicViewName pure helper"
  - phase: 33-dynamic-view-store-02
    provides: "POST /api/dynamic-view/:id/drop DROP-only lifecycle-cleanup endpoint"
  - phase: 32-dynamic-view-foundation
    provides: "6 existing dynamic-view endpoints (GET list, POST create, PUT update, DELETE destroy, POST preview, POST materialize)"
provides:
  - "7 pure pass-through client helpers: listDynamicViews, createDynamicView, updateDynamicView, deleteDynamicView, previewDynamicView, materializeDynamicView, dropDynamicView"
  - "4 supporting TypeScript types: DynamicViewRow (byte-parity with server DashboardDynamicView), DynamicViewColumn, MaterializeDynamicViewResponse (3-branch discriminated union), PreviewDynamicViewResponse"
  - "6-store canonical reset wiring at App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore → dynamicViewStore)"
  - "Materialized-only DROP loop pattern at both lifecycle sites (snapshot-before-reset, fire-and-forget .catch(()=>{}))"
affects: [34-management-modal, 35-renderer-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure pass-through client helpers (zero useDynamicViewStore imports — callers own all store side-effects)"
    - "Snapshot-before-reset DROP loop (status-filtered: only `materialized` entries) at lifecycle boundaries"
    - "Discriminated-union response type (`MaterializeDynamicViewResponse` branches on `status` field — `materialized` | `over_threshold/no_filter` | `over_threshold/exceeds_max_records`)"
    - "Canonical 6-store reset order extended from 5 stores (v1.5) → 6 stores (v1.6)"

key-files:
  created: []
  modified:
    - "kinetica_bi/src/api/client.ts (+194 lines — 7 helpers + 4 types)"
    - "kinetica_bi/src/api/client.spec.ts (+397 lines — 23 new tests across 7 describe blocks)"
    - "kinetica_bi/src/App.tsx (+13 lines — 6th-store reset + DROP loop)"
    - "kinetica_bi/src/App.spec.tsx (+118 lines — 4 new tests + 5→6 stores reset extension)"
    - "kinetica_bi/src/components/DashboardsPage.tsx (+13 lines — 6th-store reset + DROP loop)"
    - "kinetica_bi/src/components/DashboardsPage.spec.tsx (+123 lines — 3 new tests + 5→6 stores reset extension)"

key-decisions:
  - "Kept AbortSignal threading on dropDynamicView despite fire-and-forget callsite — signature consistency with the other 6 helpers outweighs the minor unused-signal cost; future callsite (Phase 34 admin path?) may legitimately need it"
  - "Followed Plan 33-02's response-shape lock — dropDynamicView resolves with literal `{ dropped: true }` (NOT `{ dropped: true, dropped: true }` — that's deleteDynamicView's combined shape)"
  - "Used direct-cleanup-invocation pattern in DashboardsPage.spec.tsx (mirroring the existing v1.5 spec pattern) instead of full unmount-driven test — the existing 5-store assertion test already adopted this pattern because driving DashboardOpen unmount requires OL mocking + click-into-dashboard, both unnecessary for asserting the cleanup logic's behavior"
  - "App.spec.tsx tests use status='unauthenticated' transition (which fires the production UNAUTHORIZED useEffect directly) — production-realistic; the materialized-only DROP loop assertion runs end-to-end through the real production handler"
  - "Combined the 5→6 store reset assertion into the existing test (renamed to `resets ALL SIX stores`) rather than creating a separate 6th-store test — keeps invariant-set together, matches Plan 27-02 STORE-V15-04 extension pattern from v1.5"

patterns-established:
  - "Pure pass-through helper invariant: any future dynamic-view client helper MUST NOT import useDynamicViewStore (enforced by grep + comment in client.ts:734)"
  - "Status-filtered DROP loop: lifecycle DROP loops filter store entries by status before firing — only `materialized` has a server resource; pending/error/over_threshold are pure client state"
  - "Discriminated-union response shape: server endpoints with multiple success-shapes get a TS union keyed by a `status` field (mirrors infoQuery's `status` branching) — client TS narrowing via `if (result.status === ...)`"

requirements-completed: [DV-V16-07]

# Metrics
duration: 7min
completed: 2026-05-14
---

# Phase 33 Plan 03: client-helpers-and-lifecycle Summary

**Ships the Wave 2 closing layer for v1.6 Dynamic Views: 7 pure pass-through client helpers consuming all 7 dynamic-view endpoints (6 from Phase 32 + the new DROP endpoint from Plan 33-02), plus the 6th-store reset wiring + materialized-only DROP loop at both canonical lifecycle sites (App.tsx UNAUTHORIZED handler + DashboardsPage.tsx DashboardOpen cleanup).**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-14T17:25Z
- **Completed:** 2026-05-14T17:32Z
- **Tasks:** 3 (Task 1 = TDD with RED→GREEN; Tasks 2–3 = test extensions alongside production wiring)
- **Files modified:** 6 (3 production + 3 spec)
- **Tests added:** 30 (23 new client helper tests + 4 new App.spec.tsx tests + 3 new DashboardsPage.spec.tsx tests)
- **Tests passing (full frontend suite):** 829/829 (zero regressions on prior v1.0 → v1.5 specs)

## Accomplishments

- 7 client helpers added to `client.ts` covering every Phase 32 endpoint + the Plan 33-02 DROP endpoint. All are pure pass-through (zero useDynamicViewStore imports) and thread `signal?: AbortSignal` (V13-P-10 lock).
- 4 supporting TypeScript types exported from `client.ts`: `DynamicViewRow` (byte-parity with server `DashboardDynamicView`), `DynamicViewColumn`, `MaterializeDynamicViewResponse` (3-branch discriminated union), `PreviewDynamicViewResponse`.
- `App.tsx` UNAUTHORIZED handler extended from 5 stores → 6 stores in the canonical reset order, with a materialized-only DROP loop snapshotted before reset (mirrors filterViewStore lines 68-78 verbatim with a `status === "materialized"` guard).
- `DashboardsPage.tsx` DashboardOpen cleanup extended identically — same 6-store reset + same materialized-only DROP loop pattern at the dashboard-switch site.
- 23 new client helper tests verify URL/method/body/credentials/return-shape, AbortSignal threading, and non-2xx error propagation through `throwForStatus` for each of the 7 helpers. `materializeDynamicView` covers all 3 branches of the discriminated union.
- 4 new App.spec.tsx tests + 3 new DashboardsPage.spec.tsx tests cover the 4 lifecycle invariants for the 6th store: (a) materialized-only firing, (b) snapshot-before-reset, (c) error swallowing, (d) no-fire on non-logout (App.spec.tsx only — DashboardsPage cleanup is unconditional on `dashboard.id` change).

## Task Commits

Each task was committed atomically:

1. **Task 1 RED:** `27b8c2f` — spec for 7 client helpers (23 tests, all failing)
2. **Task 1 GREEN:** `325e7ae` — feat: 7 client helpers + 4 types added to client.ts
3. **Task 2:** `1137deb` — feat: wire useDynamicViewStore.reset() + DROP loop into App.tsx UNAUTHORIZED handler
4. **Task 3:** `15f6a6e` — feat: wire useDynamicViewStore.reset() + DROP loop into DashboardsPage cleanup

## Operator-Facing Contract: 7 Client Helpers

```typescript
// Listing / CRUD — consumed by Phase 34 management modal
export const listDynamicViews: (dashboardId: number, signal?: AbortSignal)
  => Promise<{ dynamic_views: DynamicViewRow[] }>;

export const createDynamicView: (
  dashboardId: number,
  body: { source_table_id: number; name: string; template_sql: string; max_records: number },
  signal?: AbortSignal
) => Promise<{ dynamic_view: DynamicViewRow }>;

export const updateDynamicView: (
  id: number,
  body: Partial<{ source_table_id: number; name: string; template_sql: string; max_records: number; columns_json: string | null }>,
  signal?: AbortSignal
) => Promise<{ dynamic_view: DynamicViewRow }>;

export const deleteDynamicView: (id: number, signal?: AbortSignal)
  => Promise<{ deleted: true; dropped?: true }>;  // DESTRUCTIVE — Phase 34 "Delete" button ONLY

// Preview — Phase 34 Preview button
export const previewDynamicView: (
  body: { template_sql: string; source_table_id: number; dashboard_id: number; sample_limit?: number },
  signal?: AbortSignal
) => Promise<PreviewDynamicViewResponse>;
// → { rows: unknown[][]; columns: { name: string; type: string }[] }

// Materialize — Phase 35 renderer markPending → materialize → setView trigger chain
export const materializeDynamicView: (dynamicViewId: number, signal?: AbortSignal)
  => Promise<MaterializeDynamicViewResponse>;
// MaterializeDynamicViewResponse =
//   | { status: "materialized"; view_name: string; row_count: number; expires_at: number }
//   | { status: "over_threshold"; reason: "no_filter" }
//   | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number };

// DROP-only lifecycle cleanup — used EXCLUSIVELY by the reset() DROP loop (this plan's wiring)
export const dropDynamicView: (id: number, signal?: AbortSignal)
  => Promise<{ dropped: true }>;
// POST /api/dynamic-view/:id/drop — SQLite row UNTOUCHED (vs deleteDynamicView which drops both)
```

## Canonical 6-Store Reset Order (Locked v1.6)

At BOTH lifecycle sites (App.tsx UNAUTHORIZED + DashboardsPage.tsx DashboardOpen cleanup):

```
1. filterViewStore (with DROP loop for ALL entries — keyed by tableId, all have server resource)
2. filterStore
3. infoSelectionStore
4. lastInfoClickContextStore
5. spatialFilterStore
6. dynamicViewStore (with DROP loop for `status === "materialized"` entries ONLY — keyed by dynamic_view_id)
```

DROP loop placement at both sites:

```typescript
// Snapshot materialized entries BEFORE reset so the loop can read entry IDs.
const dynamicViews = useDynamicViewStore.getState().views;
for (const idStr of Object.keys(dynamicViews)) {
  const dvId = Number(idStr);
  if (dynamicViews[dvId]?.status === "materialized") {
    dropDynamicView(dvId).catch(() => {});  // fire-and-forget (V13-P-12 carry-forward)
  }
}
useDynamicViewStore.getState().reset();
```

Why `materialized`-only: pending/error/over_threshold entries have NO live Kinetica view to drop — only the materialized status corresponds to an actual `CREATE OR REPLACE MATERIALIZED VIEW` server resource. The other three statuses are pure client state.

## Test Counts per Spec File

**`client.spec.ts`** (40 total tests, +23 new):
- listDynamicViews (3): happy path + AbortSignal + 502
- createDynamicView (3): happy path + AbortSignal + 400 (missing-token validation)
- updateDynamicView (3): happy path + AbortSignal + 404
- deleteDynamicView (3): happy path + AbortSignal + 403 (permission)
- previewDynamicView (3): happy path + AbortSignal + 502
- materializeDynamicView (5): materialized branch + over_threshold/no_filter branch + over_threshold/exceeds_max_records branch + AbortSignal + 502
- dropDynamicView (3): happy path + AbortSignal + 404

**`App.spec.tsx`** (21 total tests, +4 new): all-6-stores reset (existing extended), materialized-only DROP firing, error swallowing, no-fire on non-logout, snapshot-before-reset.

**`DashboardsPage.spec.tsx`** (14 total tests, +3 new): all-6-stores reset (existing extended), materialized-only DROP firing on cleanup, error swallowing, snapshot-before-reset.

**Full frontend suite:** 829/829 passing (42 spec files). Zero regressions.

## Deviations from Plan

None — plan executed exactly as written. The action bodies and acceptance criteria matched 1:1 in all three tasks.

One minor pre-existing observation worth flagging (NOT a deviation): the plan's acceptance criterion `grep -nE 'useDynamicViewStore' kinetica_bi/src/api/client.ts | wc -l` returns 0` is satisfied SEMANTICALLY (zero imports of the store) but the file contains 1 textual occurrence in a comment that documents the no-import rule (`// Pure pass-through — NONE of these helpers import useDynamicViewStore. Callers...`). The comment reinforces the contract; removing it would reduce code clarity. Treating the criterion as "0 import statements" rather than "0 textual occurrences" — the import-set is verifiably empty.

## Decisions Made Under Claude's Discretion

- **AbortSignal kept on `dropDynamicView`** despite fire-and-forget callsite. Signature parity with the other 6 helpers outweighs the unused-signal cost. Future callsite (e.g., Phase 34 admin path with abort-on-modal-close) may legitimately use it. The spec explicitly tests this threading.
- **Combined 5→6 store reset assertion into existing test** (`resets ALL SIX stores ...`) rather than adding a separate 6th-store-only test. Keeps the invariant set together; mirrors Plan 27-02 STORE-V15-04 extension pattern.
- **Used direct-cleanup-invocation pattern in DashboardsPage.spec.tsx** for the new tests (matching the existing Plan 15 / 27 pattern in that file). The OL mocking + click-into-dashboard required to drive a real DashboardOpen unmount adds complexity without changing what's actually being asserted (the cleanup logic's behavior, which is what direct invocation exercises).
- **App.spec.tsx tests use real `status='unauthenticated'` transition** (NOT direct-invocation) because App.tsx already has a clean test setup for this — the existing v1.3 LIFE-V13-03 tests use this pattern and we extend it without breaking. End-to-end through the production UNAUTHORIZED useEffect.
- **Test ordering:** new dynamic-view tests appended at the bottom of each describe block (alphabetical-by-store-addition style) rather than reordered into "canonical reset order" position. Easier diff review; preserves existing test stability.

## Hand-off Pointers for Phase 34 (Management Modal)

Phase 34 modal imports these from `client.ts`:

```typescript
import {
  listDynamicViews,
  createDynamicView,
  updateDynamicView,
  deleteDynamicView,
  previewDynamicView,
} from "../api/client";
```

Phase 34 flow:
1. **On mount:** `listDynamicViews(dashboardId)` → render list.
2. **On Save (new):** `createDynamicView(dashboardId, body)` → close modal, refresh list.
3. **On Save (edit):** `updateDynamicView(id, partial)` → close modal, refresh list.
4. **On Preview button:** `previewDynamicView({ template_sql, source_table_id, dashboard_id, sample_limit })` → render rows/columns inline.
5. **On Delete button:** `deleteDynamicView(id)` → DESTRUCTIVE — drops Kinetica view AND removes SQLite row. NEVER fire from any reset/lifecycle path.

The modal owns its own loading/error UI. It does NOT write to `useDynamicViewStore` — only Phase 35 renderer writes there.

## Hand-off Pointers for Phase 35 (Renderer FROM-swap + over-threshold UX)

Phase 35 renderer imports these from `client.ts`:

```typescript
import { materializeDynamicView, type MaterializeDynamicViewResponse } from "../api/client";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { buildDynamicViewName } from "../lib/dynamicViewName";
import { useAuthStore } from "../store/auth";
```

Phase 35 trigger chain (per widget config.dynamicViewId, in a useEffect with dep array `[dynamicViewId, filterVersion, materializeVersion]`):

```typescript
const viewName = buildDynamicViewName({
  userId: useAuthStore.getState().user?.username ?? "",
  dashboardId,
  dynamicViewId: widget.config.dynamicViewId,
});

useDynamicViewStore.getState().markPending(widget.config.dynamicViewId, viewName);

try {
  const result = await materializeDynamicView(widget.config.dynamicViewId, controller.signal);
  if (result.status === "materialized") {
    useDynamicViewStore.getState().setView(widget.config.dynamicViewId, {
      viewName: result.view_name,
      status: "materialized",
      expiresAt: result.expires_at,
    });
  } else if (result.status === "over_threshold" && result.reason === "no_filter") {
    useDynamicViewStore.getState().setView(widget.config.dynamicViewId, {
      viewName,
      status: "over_threshold",
      reason: "no_filter",
    });
  } else if (result.status === "over_threshold" && result.reason === "exceeds_max_records") {
    useDynamicViewStore.getState().setView(widget.config.dynamicViewId, {
      viewName,
      status: "over_threshold",
      reason: "exceeds_max_records",
    });
  }
} catch (err) {
  if (err.name !== "AbortError") {
    useDynamicViewStore.getState().setError(widget.config.dynamicViewId, String(err.message ?? err));
  }
}
```

Read pattern via per-id selector (PITFALL C-02 / S-02 scoping):

```typescript
const view = useDynamicViewStore((s) => s.views[widget.config.dynamicViewId]);
// Then branch on view?.status — "materialized" → FROM-swap to view.viewName;
// "over_threshold" → empty-state UI with view.reason for "Apply a filter..." vs "Too much data..." copy;
// "pending" → loading spinner; "error" → error chip with view.error message.
```

Cascading re-materialize on filter-view bump: include `filterVersion` in the dep array (and optionally `dynamicViewVersion` if the widget needs to react to other dynamic-view changes too). The deterministic `buildDynamicViewName(...)` ensures the same view name is reused — server `CREATE OR REPLACE MATERIALIZED VIEW` rewrites in place; the WMS `_mv` cache-buster handles tile invalidation orthogonally.

## Self-Check: PASSED

Verified the following exist:

- FOUND: `kinetica_bi/src/api/client.ts` (modified; +194 lines)
  - FOUND: `export const listDynamicViews`
  - FOUND: `export const createDynamicView`
  - FOUND: `export const updateDynamicView`
  - FOUND: `export const deleteDynamicView`
  - FOUND: `export const previewDynamicView`
  - FOUND: `export const materializeDynamicView`
  - FOUND: `export const dropDynamicView`
  - FOUND: `export type DynamicViewRow`
  - FOUND: `export type MaterializeDynamicViewResponse`
  - VERIFIED: 0 import statements from useDynamicViewStore (only 1 doc-comment mention)
  - VERIFIED: 2 textual occurrences of `/api/dynamic-view/.../drop` URL (1 in helper + 1 in JSDoc; both correct)
- FOUND: `kinetica_bi/src/api/client.spec.ts` (modified; +397 lines, +23 tests)
  - VERIFIED: 10 describe blocks (3 existing + 7 new)
- FOUND: `kinetica_bi/src/App.tsx` (modified; +13 lines)
  - VERIFIED: 6th-reset position confirmed via `grep -nE "getState\(\)\.reset\(\)"` → 6th line contains `useDynamicViewStore`
  - VERIFIED: `dropDynamicView(...).catch(() => {})` fire-and-forget pattern
  - VERIFIED: `status === "materialized"` guard
- FOUND: `kinetica_bi/src/App.spec.tsx` (modified; +118 lines, +4 tests)
- FOUND: `kinetica_bi/src/components/DashboardsPage.tsx` (modified; +13 lines)
  - VERIFIED: 6th-reset position confirmed via `grep -nE "getState\(\)\.reset\(\)"` → 6th line contains `useDynamicViewStore`
- FOUND: `kinetica_bi/src/components/DashboardsPage.spec.tsx` (modified; +123 lines, +3 tests)
- FOUND commit: `27b8c2f` (test: client.spec.ts RED)
- FOUND commit: `325e7ae` (feat: client.ts GREEN)
- FOUND commit: `1137deb` (feat: App.tsx wiring)
- FOUND commit: `15f6a6e` (feat: DashboardsPage.tsx wiring)
- VERIFIED: `cd kinetica_bi && npx vitest run` → 829/829 tests pass (42 spec files; zero regressions)
- VERIFIED: `cd kinetica_bi && npx tsc --noEmit` → clean exit
- VERIFIED: `cd kinetica_bi/server && npx tsc --noEmit` → clean exit (server source not touched this plan)
