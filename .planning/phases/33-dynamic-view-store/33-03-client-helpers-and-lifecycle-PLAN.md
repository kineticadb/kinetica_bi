---
phase: 33-dynamic-view-store
plan: 03
type: execute
wave: 2
depends_on:
  - 33-dynamic-view-store-01
  - 33-dynamic-view-store-02
files_modified:
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/api/client.spec.ts
  - kinetica_bi/src/App.tsx
  - kinetica_bi/src/App.spec.tsx
  - kinetica_bi/src/components/DashboardsPage.tsx
  - kinetica_bi/src/components/DashboardsPage.spec.tsx
autonomous: true
requirements:
  - DV-V16-07
must_haves:
  truths:
    - "`client.ts` exports 7 new helpers: `listDynamicViews`, `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView`. All thread `signal?: AbortSignal` (V13-P-10)."
    - "All 7 helpers are PURE PASS-THROUGH — none import `useDynamicViewStore`; callers (Phase 34 modal, Phase 35 renderer, this plan's lifecycle wiring) own all store side-effects."
    - "`materializeDynamicView` response type is a discriminated union by `status`: `{ status: 'materialized', view_name, row_count, expires_at } | { status: 'over_threshold', reason: 'no_filter' } | { status: 'over_threshold', reason: 'exceeds_max_records', row_count }`."
    - "`App.tsx` UNAUTHORIZED handler invokes all 6 stores' `reset()` in canonical order: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore → dynamicViewStore (6th, last)."
    - "`App.tsx` UNAUTHORIZED handler fires a DROP loop calling `dropDynamicView(id).catch(() => {})` for each entry where `status === 'materialized'` (and ONLY those entries), snapshotted BEFORE `useDynamicViewStore.getState().reset()`."
    - "`DashboardsPage.tsx` DashboardOpen cleanup mirrors the same 6-store reset order + the same materialized-only DROP loop, snapshotted before reset."
    - "DROP loop is fire-and-forget — `.catch(()=>{})` swallows errors so logout / dashboard switch is never blocked by network latency or upstream Kinetica failures (V13-P-12 carry-forward)."
    - "Extended `App.spec.tsx` asserts: (a) all 6 stores' reset() called on UNAUTHORIZED; (b) `dropDynamicView` called for each `materialized` entry; (c) NOT called for `pending`/`over_threshold`/`error` entries; (d) snapshot taken BEFORE reset."
    - "Extended `DashboardsPage.spec.tsx` asserts the same 4 invariants on DashboardOpen unmount."
    - "Extended `client.spec.ts` covers all 7 helpers with happy path + error path + AbortSignal threading verification."
  artifacts:
    - path: "kinetica_bi/src/api/client.ts"
      provides: "7 new exports: listDynamicViews, createDynamicView, updateDynamicView, deleteDynamicView, previewDynamicView, materializeDynamicView, dropDynamicView + supporting types DynamicViewRow, DynamicViewColumn, MaterializeDynamicViewResponse, PreviewDynamicViewResponse"
      contains: "export const dropDynamicView"
    - path: "kinetica_bi/src/api/client.spec.ts"
      provides: "Test coverage for all 7 new helpers (≥ 14 tests added)"
    - path: "kinetica_bi/src/App.tsx"
      provides: "6th store reset + DROP loop wired into UNAUTHORIZED handler"
      contains: "useDynamicViewStore.getState().reset()"
    - path: "kinetica_bi/src/App.spec.tsx"
      provides: "Test assertions: 6-store reset order, materialized-only DROP loop, snapshot-before-reset"
    - path: "kinetica_bi/src/components/DashboardsPage.tsx"
      provides: "6th store reset + DROP loop wired into DashboardOpen cleanup"
      contains: "useDynamicViewStore.getState().reset()"
    - path: "kinetica_bi/src/components/DashboardsPage.spec.tsx"
      provides: "Test assertions: 6-store reset order, materialized-only DROP loop, snapshot-before-reset"
  key_links:
    - from: "kinetica_bi/src/App.tsx UNAUTHORIZED handler"
      to: "kinetica_bi/src/store/dynamicViewStore.ts useDynamicViewStore.reset"
      via: "imperative .getState().reset() call as 6th line in canonical reset block"
      pattern: "useDynamicViewStore\\.getState\\(\\)\\.reset\\(\\)"
    - from: "kinetica_bi/src/App.tsx UNAUTHORIZED handler"
      to: "kinetica_bi/src/api/client.ts dropDynamicView"
      via: "DROP loop iterating views with status === 'materialized', fire-and-forget with .catch(()=>{})"
      pattern: "dropDynamicView\\("
    - from: "kinetica_bi/src/components/DashboardsPage.tsx DashboardOpen cleanup"
      to: "kinetica_bi/src/store/dynamicViewStore.ts useDynamicViewStore.reset"
      via: "imperative .getState().reset() call as 6th line in canonical reset block"
      pattern: "useDynamicViewStore\\.getState\\(\\)\\.reset\\(\\)"
    - from: "kinetica_bi/src/components/DashboardsPage.tsx DashboardOpen cleanup"
      to: "kinetica_bi/src/api/client.ts dropDynamicView"
      via: "DROP loop iterating views with status === 'materialized', fire-and-forget"
      pattern: "dropDynamicView\\("
    - from: "kinetica_bi/src/api/client.ts dropDynamicView"
      to: "kinetica_bi/server/src/index.ts POST /api/dynamic-view/:id/drop"
      via: "fetch POST to /api/dynamic-view/:id/drop with credentials: include (from apiFetch)"
      pattern: "/api/dynamic-view/\\$\\{.*\\}/drop|/api/dynamic-view/.*\\/drop"
---

<objective>
Wave 2 closing plan for Phase 33. Ships:
1. Seven pure pass-through client helpers in `client.ts` (consuming the Phase 32 endpoints + the new Plan 33-02 drop endpoint).
2. Lifecycle reset wiring — `useDynamicViewStore.reset()` as the 6th store + a DROP loop that fires `dropDynamicView` for each `status: "materialized"` entry — at BOTH `App.tsx` UNAUTHORIZED handler AND `DashboardsPage.tsx` DashboardOpen cleanup.
3. Extended `client.spec.ts` covering all 7 helpers.
4. Extended `App.spec.tsx` + `DashboardsPage.spec.tsx` asserting the 6-store reset + materialized-only DROP loop + snapshot-before-reset invariant.

Purpose: Closes DV-V16-07. Activates the store from Plan 33-01 at the two canonical lifecycle sites so the v1.5 → v1.6 transition extends naturally from 5 stores to 6 stores. The DROP loop is the bridge between client-side dynamic-view state and the new server-side DROP-only primitive (Plan 33-02).

Output: 7 new helpers + lifecycle wiring at 2 sites + 4 extended spec files. After this plan: `useDynamicViewStore` is fully operational at the lifecycle boundary (success criterion 3 satisfied), and Phase 34 / 35 can consume the client helpers without any further plumbing work.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/33-dynamic-view-store/33-CONTEXT.md
@.planning/phases/33-dynamic-view-store/33-01-store-and-naming-helper-PLAN.md
@.planning/phases/33-dynamic-view-store/33-02-server-drop-endpoint-PLAN.md
@.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md

<interfaces>
<!-- Plan 33-01 exports (importable after Plan 33-01 lands). -->

From `kinetica_bi/src/store/dynamicViewStore.ts`:
```typescript
export type DynamicViewStatus = "materialized" | "over_threshold" | "pending" | "error";
export type DynamicViewReason = "no_filter" | "exceeds_max_records";
export type DynamicViewEntry = {
  viewName: string;
  status: DynamicViewStatus;
  expiresAt?: number;
  error?: string;
  reason?: DynamicViewReason;
};
export const useDynamicViewStore: UseBoundStore<...>;
// .getState() returns { views: Record<number, DynamicViewEntry>, dynamicViewVersion: number, setView, markPending, setError, clearView, reset }
```

<!-- Plan 33-02 endpoint contract. -->

POST /api/dynamic-view/:id/drop:
- Request: empty body
- Response 200: `{ dropped: true }`
- Response 404: `{ error: "Dynamic view not found." }`
- Response 400: `{ error: "id path param must be numeric." }`

<!-- Phase 32 existing endpoints this plan wires the remaining 6 helpers against. -->

Existing endpoints (already shipped by Phase 32):
- `GET    /api/dashboards/:dashboardId/dynamic-views` → `{ dynamic_views: DynamicViewRow[] }`
- `POST   /api/dashboards/:dashboardId/dynamic-views` (body: `{ source_table_id, name, template_sql, max_records }`) → `{ dynamic_view: DynamicViewRow }` (201)
- `PUT    /api/dynamic-views/:id` (body: `Partial<{ source_table_id, name, template_sql, max_records, columns_json }>`) → `{ dynamic_view: DynamicViewRow }`
- `DELETE /api/dynamic-view/:id` → `{ deleted: true, dropped: true }`
- `POST   /api/dynamic-view/preview` (body: `{ template_sql, source_table_id, dashboard_id, sample_limit? }`) → `{ rows: unknown[][], columns: { name: string, type: string }[] }`
- `POST   /api/dynamic-view/materialize` (body: `{ dynamic_view_id }`) → discriminated union (see MaterializeDynamicViewResponse below).

<!-- Server-side row shape this plan must mirror byte-for-byte. -->

From `kinetica_bi/server/src/db/dashboardDynamicViews.ts` (or wherever `DashboardDynamicView` is declared):
```typescript
type DashboardDynamicView = {
  id: number;
  dashboard_id: number;
  source_table_id: number;
  name: string;
  template_sql: string;
  max_records: number;
  columns_json: string | null;
  created_at: string;
  updated_at: string;
};
```

Frontend `DynamicViewRow` type MUST mirror this shape verbatim (Plan 32 established the byte-parity pattern).

<!-- Required materializeDynamicView response shape (discriminated union by status). -->

```typescript
export type MaterializeDynamicViewResponse =
  | { status: "materialized"; view_name: string; row_count: number; expires_at: number }
  | { status: "over_threshold"; reason: "no_filter" }
  | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number };
```

<!-- Pattern templates (mirror at action-by-action level). -->

`kinetica_bi/src/api/client.ts` patterns:
- Lines 610-624 `materializeFilter` — body POST + AbortSignal + throwForStatus + typed response. Primary template for materializeDynamicView, previewDynamicView.
- Lines 635-652 `dropFilterView` — DELETE-with-query-string variant. Useful reference for how status-200 responses (NOT 204) are handled. dropDynamicView is similar in spirit but uses POST.
- Lines 715-729 `infoQuery` — discriminated-union response shape (status branches). Reference for materializeDynamicView's response type.
- Top-of-file (lines 39-80) — `apiFetch` (credentials: include + UNAUTHORIZED dispatch) and `throwForStatus` (typed error class routing). All helpers use these.

`kinetica_bi/src/api/client.spec.ts` patterns:
- Existing describe blocks (`materializeFilter`, `dropFilterView`, `infoQuery`) — happy path + error path + AbortSignal threading. Mirror this for the 7 new helpers.

<!-- Lifecycle wiring reference (the canonical sites this plan extends from 5 stores → 6 stores). -->

`kinetica_bi/src/App.tsx` lines 65-93 — UNAUTHORIZED handler. Currently (after v1.5):
```typescript
useEffect(() => {
  if (status === "unauthenticated") {
    // LIFE-V13-03: snapshot active filter views BEFORE reset so the loop can read entry.dashboardId.
    const views = useFilterViewStore.getState().views;
    for (const tableIdStr of Object.keys(views)) {
      const tableId = Number(tableIdStr);
      const entry = views[tableId];
      dropFilterView({ dashboardId: entry.dashboardId, tableId }).catch(() => {});
    }
    useFilterViewStore.getState().reset();
    useFilterStore.getState().reset();
    useInfoSelectionStore.getState().reset();
    useLastInfoClickContextStore.getState().reset();
    useSpatialFilterStore.getState().reset();
  }
}, [status]);
```

Phase 33 adds (between spatialFilterStore.reset() and the closing brace):
```typescript
    // Phase 33 DV-V16-07: 6th store + DROP loop for materialized dynamic views.
    // Snapshot materialized entries BEFORE reset so the loop can read entry IDs.
    const dynamicViews = useDynamicViewStore.getState().views;
    for (const idStr of Object.keys(dynamicViews)) {
      const dvId = Number(idStr);
      if (dynamicViews[dvId]?.status === "materialized") {
        // Fire-and-forget — errors swallowed (V13-P-12: user is logging out, nothing to surface).
        dropDynamicView(dvId).catch(() => {});
      }
    }
    useDynamicViewStore.getState().reset();
```

`kinetica_bi/src/components/DashboardsPage.tsx` lines 386-415 — DashboardOpen cleanup mirrors the exact same insertion point.

Existing spec patterns to extend:
- `kinetica_bi/src/App.spec.tsx` lines 38-51 — `dropFilterView` is mocked via `vi.mock("./api/client")`. The new spec coverage adds `dropDynamicView` to the same mock block.
- `kinetica_bi/src/App.spec.tsx` lines 213-340 — existing tests for "fires dropFilterView for each active view", "swallows errors silently", "does NOT fire on auth=authenticated". Mirror these for `dropDynamicView`.
- `kinetica_bi/src/components/DashboardsPage.spec.tsx` lines 61-160 — same pattern at the DashboardOpen unmount site.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add 7 client helpers to `client.ts` + extend `client.spec.ts` coverage</name>
  <files>kinetica_bi/src/api/client.ts, kinetica_bi/src/api/client.spec.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts (read in full — focus on lines 1-80 for `apiFetch` + `throwForStatus` + error classes, lines 600-730 for the existing `materializeFilter` / `dropFilterView` / `infoQuery` templates this plan mirrors)
    - kinetica_bi/src/api/client.spec.ts (read in full — confirm the describe-block style for each helper: happy path + 4xx error path + AbortSignal threading)
    - kinetica_bi/server/src/index.ts lines 842-1250 (read for the 6 existing Phase 32 endpoint contracts — req/resp shapes, status codes, validation behavior)
    - kinetica_bi/server/src/db.ts lines 540-610 (read for `DashboardDynamicView` shape — frontend `DynamicViewRow` type must mirror it)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md § "Client helpers (6 helpers …)" lines 89-112 — locked spec for all 7 helpers (the 6 numbered + dropDynamicView as #7)
    - .planning/phases/32-dynamic-view-foundation/32-03-preview-materialize-delete-PLAN.md (read in full — confirm exact response shapes for preview + materialize + delete endpoints)
  </read_first>
  <behavior>
    Each of the 7 helpers, in `client.spec.ts`:
    - Test: happy path — mock fetch returns appropriate success body; helper resolves with typed result; fetch called with correct URL + method + body + credentials.
    - Test: error path — mock fetch returns non-2xx (typically 400 or 502); helper rejects via throwForStatus path (Error / UpstreamError / etc.).
    - Test: AbortSignal threading — helper called with `signal: AbortController.signal`; AbortError propagates natively (not swallowed).

    Specific behaviors per helper:
    - **listDynamicViews**: `GET /api/dashboards/${dashboardId}/dynamic-views` → returns full `{ dynamic_views: DynamicViewRow[] }` server shape.
    - **createDynamicView**: `POST /api/dashboards/${dashboardId}/dynamic-views`, JSON body, returns `{ dynamic_view: DynamicViewRow }`. 400 returned when `{view}` token missing from `template_sql` (server-side validation; helper just propagates).
    - **updateDynamicView**: `PUT /api/dynamic-views/${id}`, JSON body (partial), returns `{ dynamic_view: DynamicViewRow }`.
    - **deleteDynamicView**: `DELETE /api/dynamic-view/${id}`, returns `{ deleted: true }`. (Note server actually returns `{ deleted: true, dropped: true }` per existing handler — the helper's TS return type can be `{ deleted: true; dropped?: true }` for forward-compat.)
    - **previewDynamicView**: `POST /api/dynamic-view/preview`, JSON body `{ template_sql, source_table_id, dashboard_id, sample_limit? }`, returns `{ rows: unknown[][], columns: { name: string, type: string }[] }`.
    - **materializeDynamicView**: `POST /api/dynamic-view/materialize`, JSON body `{ dynamic_view_id }`, returns the discriminated union `MaterializeDynamicViewResponse`. Spec test asserts each of the three branches deserializes correctly.
    - **dropDynamicView**: `POST /api/dynamic-view/${id}/drop`, empty body, returns `{ dropped: true }`. 404 returned when row missing (helper propagates via throwForStatus).
  </behavior>
  <action>
    1. Append to `kinetica_bi/src/api/client.ts` AFTER the existing `infoQuery` block (around line 729). Concrete additions:

    ```typescript
    // ===========================================================================
    // Phase 33 (DV-V16-07): Dynamic Views client helpers.
    //
    // Pure pass-through — NONE of these helpers import useDynamicViewStore. Callers
    // (Phase 34 modal at create/edit/preview/delete; Phase 35 renderer at markPending →
    // materialize → setView; this plan's lifecycle wiring at App.tsx + DashboardsPage.tsx)
    // own all store side-effects. Locked across v1.3 / v1.4 / v1.5 / v1.6.
    //
    // All helpers thread AbortSignal? per V13-P-10 — caller may abort in-flight calls
    // when dropdowns switch, dashboards unmount, or AbortControllers re-fire.
    //
    // Type byte-parity (Plan 32 § D3 pattern): DynamicViewRow mirrors server
    // DashboardDynamicView at kinetica_bi/server/src/db.ts:* verbatim.
    // ===========================================================================

    /** Server-side row shape from kinetica_bi/server/src/db.ts DashboardDynamicView (Plan 32). */
    export type DynamicViewRow = {
      id: number;
      dashboard_id: number;
      source_table_id: number;
      name: string;
      template_sql: string;
      max_records: number;
      columns_json: string | null;
      created_at: string;
      updated_at: string;
    };

    /** Preview response column metadata — name + Kinetica column datatype string. */
    export type DynamicViewColumn = {
      name: string;
      type: string;
    };

    /** Discriminated union by `status` — three response branches from POST /api/dynamic-view/materialize. */
    export type MaterializeDynamicViewResponse =
      | { status: "materialized"; view_name: string; row_count: number; expires_at: number }
      | { status: "over_threshold"; reason: "no_filter" }
      | { status: "over_threshold"; reason: "exceeds_max_records"; row_count: number };

    /** Preview response — rows are column-major arrays (raw Kinetica shape). */
    export type PreviewDynamicViewResponse = {
      rows: unknown[][];
      columns: DynamicViewColumn[];
    };

    /** GET /api/dashboards/:dashboardId/dynamic-views — list. */
    export const listDynamicViews = async (
      dashboardId: number,
      signal?: AbortSignal,
    ): Promise<{ dynamic_views: DynamicViewRow[] }> => {
      const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/dynamic-views`, {
        method: "GET",
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to list dynamic views");
      }
      return response.json() as Promise<{ dynamic_views: DynamicViewRow[] }>;
    };

    export type CreateDynamicViewArgs = {
      source_table_id: number;
      name: string;
      template_sql: string;
      max_records: number;
    };

    /** POST /api/dashboards/:dashboardId/dynamic-views — create (server validates {view} token, returns 400 on miss). */
    export const createDynamicView = async (
      dashboardId: number,
      body: CreateDynamicViewArgs,
      signal?: AbortSignal,
    ): Promise<{ dynamic_view: DynamicViewRow }> => {
      const response = await apiFetch(`${API_BASE}/api/dashboards/${dashboardId}/dynamic-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to create dynamic view");
      }
      return response.json() as Promise<{ dynamic_view: DynamicViewRow }>;
    };

    export type UpdateDynamicViewArgs = Partial<{
      source_table_id: number;
      name: string;
      template_sql: string;
      max_records: number;
      columns_json: string | null;
    }>;

    /** PUT /api/dynamic-views/:id — partial update; server clears columns_json automatically on template_sql change. */
    export const updateDynamicView = async (
      id: number,
      body: UpdateDynamicViewArgs,
      signal?: AbortSignal,
    ): Promise<{ dynamic_view: DynamicViewRow }> => {
      const response = await apiFetch(`${API_BASE}/api/dynamic-views/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to update dynamic view");
      }
      return response.json() as Promise<{ dynamic_view: DynamicViewRow }>;
    };

    /** DELETE /api/dynamic-view/:id — DESTRUCTIVE: drops Kinetica view AND removes SQLite row. Phase 34 modal "Delete" button is the only authorized caller; never called from reset() path. */
    export const deleteDynamicView = async (
      id: number,
      signal?: AbortSignal,
    ): Promise<{ deleted: true; dropped?: true }> => {
      const response = await apiFetch(`${API_BASE}/api/dynamic-view/${id}`, {
        method: "DELETE",
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to delete dynamic view");
      }
      return response.json() as Promise<{ deleted: true; dropped?: true }>;
    };

    export type PreviewDynamicViewArgs = {
      template_sql: string;
      source_table_id: number;
      dashboard_id: number;
      sample_limit?: number;
    };

    /** POST /api/dynamic-view/preview — one-shot read; falls back to bare source-table when no active filter view exists. Server clamps sample_limit to [1, 1000], default 100. */
    export const previewDynamicView = async (
      body: PreviewDynamicViewArgs,
      signal?: AbortSignal,
    ): Promise<PreviewDynamicViewResponse> => {
      const response = await apiFetch(`${API_BASE}/api/dynamic-view/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to preview dynamic view");
      }
      return response.json() as Promise<PreviewDynamicViewResponse>;
    };

    /** POST /api/dynamic-view/materialize — threshold-gated CREATE OR REPLACE. Response is a discriminated union by `status`. */
    export const materializeDynamicView = async (
      dynamicViewId: number,
      signal?: AbortSignal,
    ): Promise<MaterializeDynamicViewResponse> => {
      const response = await apiFetch(`${API_BASE}/api/dynamic-view/materialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dynamic_view_id: dynamicViewId }),
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to materialize dynamic view");
      }
      return response.json() as Promise<MaterializeDynamicViewResponse>;
    };

    /**
     * POST /api/dynamic-view/:id/drop — Phase 33 Plan 02 endpoint. DROP-only lifecycle
     * cleanup primitive — drops the Kinetica view but leaves the SQLite row intact.
     * Used exclusively by the dynamicViewStore.reset() DROP loop in App.tsx UNAUTHORIZED +
     * DashboardsPage.tsx DashboardOpen cleanup. Fire-and-forget at the callsite:
     * `dropDynamicView(id).catch(() => {})` swallows errors so logout / dashboard switch
     * is never blocked.
     */
    export const dropDynamicView = async (
      id: number,
      signal?: AbortSignal,
    ): Promise<{ dropped: true }> => {
      const response = await apiFetch(`${API_BASE}/api/dynamic-view/${id}/drop`, {
        method: "POST",
        signal,
      });
      if (!response.ok) {
        await throwForStatus(response, "Failed to drop dynamic view");
      }
      return response.json() as Promise<{ dropped: true }>;
    };
    ```

    2. Extend `kinetica_bi/src/api/client.spec.ts`. Mirror the existing describe-block style (see lines 175-330 for `dropFilterView` + `infoQuery` as templates). Add 7 new describe blocks at the bottom of the file. Each block has at least 2 tests (happy path + 1 of {error path, AbortSignal threading}). Aim for ≥ 14 new tests total. Concrete scaffolding for ONE helper (mirror this for all 7):

    ```typescript
    describe("listDynamicViews", () => {
      it("happy path — GETs /api/dashboards/:id/dynamic-views and returns server shape", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ dynamic_views: [{ id: 1, dashboard_id: 5, source_table_id: 2, name: "x", template_sql: "SELECT * FROM {view}", max_records: 1000, columns_json: null, created_at: "2026-01-01", updated_at: "2026-01-01" }] }), { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const result = await listDynamicViews(5);

        expect(result.dynamic_views).toHaveLength(1);
        expect(result.dynamic_views[0].id).toBe(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain("/api/dashboards/5/dynamic-views");
        expect((init as RequestInit).method).toBe("GET");
        expect((init as RequestInit).credentials).toBe("include");
      });

      it("threads AbortSignal", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"dynamic_views":[]}', { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const controller = new AbortController();

        await listDynamicViews(5, controller.signal);

        const [, init] = fetchMock.mock.calls[0];
        expect((init as RequestInit).signal).toBe(controller.signal);
      });

      it("throws on non-2xx", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"error":"boom"}', { status: 502 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(listDynamicViews(5)).rejects.toThrow(/boom|Failed/i);
      });
    });
    ```

    Repeat for `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView`.

    For `materializeDynamicView` specifically, add a test asserting the discriminated union deserializes for each of the 3 branches (materialized, over_threshold/no_filter, over_threshold/exceeds_max_records).

    For `dropDynamicView`, the happy-path test must assert: POST method, URL ending in `/api/dynamic-view/${id}/drop` (note the trailing `/drop`), empty body (no `body` field in init, or body is undefined), `credentials: 'include'`.

    3. Update the import block at the top of `client.spec.ts` to add the 7 new helpers + the 4 new types.

    4. Run the spec — confirm all tests pass.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/api/client.spec.ts --reporter=verbose 2>&1 | tail -60</automated>
  </verify>
  <done>
    Seven new exports added to `client.ts` with full type signatures and AbortSignal threading. Spec covers all 7 with ≥ 14 new tests. No regressions on existing client helpers. tsc clean.
  </done>
  <acceptance_criteria>
    - `grep -nE "export const listDynamicViews" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export const createDynamicView" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export const updateDynamicView" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export const deleteDynamicView" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export const previewDynamicView" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export const materializeDynamicView" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export const dropDynamicView" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export type DynamicViewRow" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE "export type MaterializeDynamicViewResponse" kinetica_bi/src/api/client.ts` returns exactly 1 line.
    - `grep -nE 'signal\?: AbortSignal' kinetica_bi/src/api/client.ts | wc -l` returns at least 7 new occurrences (one per helper). (Total file count may exceed since existing helpers also have it.)
    - `grep -nE '/api/dynamic-view/\$\{.*\}/drop|/api/dynamic-view/.*/drop' kinetica_bi/src/api/client.ts | wc -l` returns at least 1 (URL for dropDynamicView).
    - `grep -nE 'useDynamicViewStore' kinetica_bi/src/api/client.ts | wc -l` returns 0 (PURE PASS-THROUGH — helpers must NOT import the store).
    - `grep -nE '^describe\(' kinetica_bi/src/api/client.spec.ts | wc -l` returns at least 10 (3 existing + 7 new).
    - `cd kinetica_bi && npx vitest run src/api/client.spec.ts` exits 0 with at least 14 new passing tests.
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Wire `useDynamicViewStore.reset()` + DROP loop into `App.tsx` UNAUTHORIZED handler + extend `App.spec.tsx`</name>
  <files>kinetica_bi/src/App.tsx, kinetica_bi/src/App.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/App.tsx (read in full — focus on lines 1-25 for the import block, lines 59-94 for the UNAUTHORIZED handler that this task extends from 5 stores to 6 stores)
    - kinetica_bi/src/App.spec.tsx (read in full — focus on lines 1-55 for the vi.mock("./api/client") block + the `dropFilterView` mock pattern; lines 180-340 for the existing test scaffolding for the 5-store reset block; understand how each store's getState is invoked and verified)
    - kinetica_bi/src/store/dynamicViewStore.ts (re-read after Plan 33-01 lands — confirm the exported `useDynamicViewStore` symbol + entry-shape contract used by the DROP loop)
    - kinetica_bi/src/api/client.ts (re-read the new `dropDynamicView` export after Task 1 lands)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md § "Lifecycle reset wiring (6th store)" lines 128-160 — the verbatim 6-store order + DROP loop spec
  </read_first>
  <action>
    1. Update the import block at the top of `kinetica_bi/src/App.tsx`. After the existing `useSpatialFilterStore` import (line ~13), add:

    ```typescript
    import { useDynamicViewStore } from "./store/dynamicViewStore";
    ```

    Update the existing `dropFilterView` import on line 15 to ALSO import `dropDynamicView`:

    ```typescript
    // BEFORE (line 15):
    import { UNAUTHORIZED_EVENT, dropFilterView } from "./api/client";

    // AFTER:
    import { UNAUTHORIZED_EVENT, dropFilterView, dropDynamicView } from "./api/client";
    ```

    2. In the UNAUTHORIZED useEffect handler (currently lines 68-94), add the 6th-store block AFTER `useSpatialFilterStore.getState().reset()` (line 92) and BEFORE the closing `}` of the if-status-block. Concrete insertion (VERBATIM):

    ```typescript
          useSpatialFilterStore.getState().reset();
          // Phase 33 DV-V16-07 (6th store): snapshot materialized dynamic views BEFORE
          // reset so the loop can read entry IDs. Only `status === "materialized"` entries
          // have a live Kinetica view to drop — pending/error/over_threshold have no
          // server resource. Fire-and-forget with .catch(()=>{}) — never blocks logout
          // on network latency (V13-P-12 carry-forward).
          const dynamicViews = useDynamicViewStore.getState().views;
          for (const idStr of Object.keys(dynamicViews)) {
            const dvId = Number(idStr);
            if (dynamicViews[dvId]?.status === "materialized") {
              dropDynamicView(dvId).catch(() => {});
            }
          }
          useDynamicViewStore.getState().reset();
        }
      }, [status]);
    ```

    The canonical 6-store reset order is now (locked by 33-CONTEXT.md):

    ```
    filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore →
    spatialFilterStore → dynamicViewStore (6th, last)
    ```

    DO NOT move the position of any existing reset call. DO NOT reorder anything. ONLY append the new block in the locked 6th position.

    3. Extend `kinetica_bi/src/App.spec.tsx`. Add `dropDynamicView` to the vi.mock("./api/client") block (currently line ~38-51). Concrete:

    ```typescript
    // Existing pattern (around line 38-51):
    vi.mock("./api/client", async (importOriginal) => {
      const original = await importOriginal<typeof import("./api/client")>();
      return {
        ...original,
        UNAUTHORIZED_EVENT: original.UNAUTHORIZED_EVENT,
        dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
        // ADD THIS LINE:
        dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
      };
    });

    // ALSO update the named import block to include dropDynamicView:
    import { dropFilterView, dropDynamicView } from "./api/client";
    ```

    4. Add new test cases to `App.spec.tsx`. Mirror the existing `"fires dropFilterView for each active view..."` test (around line 213) but for dynamic views. ADD these tests (concrete bodies):

    ```typescript
    import { useDynamicViewStore } from "./store/dynamicViewStore";

    // Reset the mock between tests — add to the existing beforeEach (around line 192):
    beforeEach(() => {
      (dropFilterView as ReturnType<typeof vi.fn>).mockClear();
      (dropFilterView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
      (dropDynamicView as ReturnType<typeof vi.fn>).mockClear();
      (dropDynamicView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
    });

    it("fires dropDynamicView for each MATERIALIZED entry on UNAUTHORIZED (and only materialized — pending/error/over_threshold skipped)", async () => {
      // Seed 4 entries: 1 materialized, 1 pending, 1 error, 1 over_threshold.
      useDynamicViewStore.getState().setView(10, { viewName: "_kbi_dv_mat", status: "materialized", expiresAt: Date.now() + 60000 });
      useDynamicViewStore.getState().markPending(11, "_kbi_dv_pending");
      useDynamicViewStore.getState().setError(12, "boom");
      useDynamicViewStore.getState().setView(13, { viewName: "_kbi_dv_over", status: "over_threshold", reason: "no_filter" });

      // Trigger UNAUTHORIZED — render App with status: "unauthenticated" (mirrors the existing
      // dropFilterView test setup at App.spec.tsx ~line 213). Use the same auth-mock pattern
      // already in the file.
      // ... (re-use existing render/setup pattern)

      // Wait for the useEffect to fire (microtask).
      await flushPromises();

      // ONLY entry 10 (materialized) should trigger dropDynamicView.
      expect(dropDynamicView).toHaveBeenCalledTimes(1);
      expect(dropDynamicView).toHaveBeenCalledWith(10);
      expect(dropDynamicView).not.toHaveBeenCalledWith(11);
      expect(dropDynamicView).not.toHaveBeenCalledWith(12);
      expect(dropDynamicView).not.toHaveBeenCalledWith(13);

      // Store fully reset after the loop.
      expect(useDynamicViewStore.getState().views).toEqual({});
      expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
    });

    it("swallows dropDynamicView errors silently (fire-and-forget — V13-P-12)", async () => {
      (dropDynamicView as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
      useDynamicViewStore.getState().setView(10, { viewName: "_kbi_dv_mat", status: "materialized", expiresAt: Date.now() + 60000 });

      // Trigger UNAUTHORIZED — render App... (same setup)
      await flushPromises();

      // Store still resets despite the rejection.
      expect(useDynamicViewStore.getState().views).toEqual({});
    });

    it("does NOT fire dropDynamicView when status stays 'authenticated' (no logout transition)", async () => {
      useDynamicViewStore.getState().setView(10, { viewName: "_kbi_dv_mat", status: "materialized", expiresAt: Date.now() + 60000 });
      // Render App with status: "authenticated" (existing mock setup).
      // ... (re-use existing pattern)
      await flushPromises();
      expect(dropDynamicView).not.toHaveBeenCalled();
      expect(useDynamicViewStore.getState().views[10]).toBeDefined();
    });

    it("snapshot taken BEFORE reset — DROP loop iterates the pre-reset entries, not the empty post-reset store", async () => {
      // This is implicit in the "fires for each materialized entry" test above — if the
      // implementation called reset() FIRST and then iterated views, dropDynamicView would
      // never fire because views would already be {}. Explicit assertion: dropDynamicView
      // was called WITH the expected id (10), proving the snapshot happened first.
      useDynamicViewStore.getState().setView(10, { viewName: "_kbi_dv_mat", status: "materialized", expiresAt: Date.now() + 60000 });
      // ... trigger UNAUTHORIZED
      await flushPromises();
      expect(dropDynamicView).toHaveBeenCalledWith(10);
      expect(useDynamicViewStore.getState().views).toEqual({}); // post-reset state
    });
    ```

    Also extend the existing "resets all 5 stores" assertion test (around line 237-280 in App.spec.tsx) to assert all 6 stores reset — add the `useDynamicViewStore` check alongside the existing 5:

    ```typescript
    expect(useDynamicViewStore.getState().views).toEqual({});
    expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
    ```

    5. Run the spec. Iterate until all tests pass.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/App.spec.tsx --reporter=verbose 2>&1 | tail -50</automated>
  </verify>
  <done>
    App.tsx UNAUTHORIZED handler now invokes 6 stores' reset() in canonical order. DROP loop fires for materialized-only entries before reset. App.spec.tsx assertions cover: materialized-only firing, error swallowing, no-fire on non-logout, snapshot-before-reset, 6-store reset.
  </done>
  <acceptance_criteria>
    - `grep -nE "useDynamicViewStore" kinetica_bi/src/App.tsx | wc -l` returns at least 2 (import + .getState() calls).
    - `grep -nE "useDynamicViewStore.getState\\(\\).reset\\(\\)" kinetica_bi/src/App.tsx` returns exactly 1 line.
    - `grep -nE "dropDynamicView" kinetica_bi/src/App.tsx | wc -l` returns at least 2 (import + invocation).
    - `grep -nE 'status === "materialized"' kinetica_bi/src/App.tsx | wc -l` returns at least 1 (the DROP loop filter).
    - `grep -nE "dropDynamicView\\(.*\\)\\.catch\\(\\(\\) => \\{\\}\\)" kinetica_bi/src/App.tsx | wc -l` returns at least 1 (fire-and-forget swallow).
    - In App.tsx the 6-store reset order must be `filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore → dynamicViewStore`. Verify by running: `awk '/getState\(\)\.reset\(\)/' kinetica_bi/src/App.tsx | head -6` — the 6th line must contain `useDynamicViewStore`.
    - `grep -nE "useDynamicViewStore" kinetica_bi/src/App.spec.tsx | wc -l` returns at least 3 (import + multiple test references).
    - `grep -nE "dropDynamicView" kinetica_bi/src/App.spec.tsx | wc -l` returns at least 4 (mock + multiple test assertions).
    - `cd kinetica_bi && npx vitest run src/App.spec.tsx` exits 0 with the existing tests still green AND at least 4 new tests covering the 6th store.
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Wire `useDynamicViewStore.reset()` + DROP loop into `DashboardsPage.tsx` DashboardOpen cleanup + extend `DashboardsPage.spec.tsx`</name>
  <files>kinetica_bi/src/components/DashboardsPage.tsx, kinetica_bi/src/components/DashboardsPage.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/DashboardsPage.tsx (read lines 1-30 for the import block; lines 386-417 for the DashboardOpen cleanup useEffect this task extends from 5 stores to 6 stores)
    - kinetica_bi/src/components/DashboardsPage.spec.tsx (read in full — focus on lines 60-160 for the vi.mock("../api/client") block + the existing 5-store reset assertions to mirror)
    - kinetica_bi/src/App.tsx (re-read after Task 2 lands — confirm the 6-store + DROP loop block; THIS TASK mirrors that exact pattern at the DashboardOpen cleanup site)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md § "Lifecycle reset wiring (6th store)" lines 128-160 — verbatim spec applies to BOTH App.tsx and DashboardsPage.tsx
  </read_first>
  <action>
    1. Update the import block at the top of `kinetica_bi/src/components/DashboardsPage.tsx`. After the existing `useSpatialFilterStore` import (line ~8), add:

    ```typescript
    import { useDynamicViewStore } from "../store/dynamicViewStore";
    ```

    Update the existing client import to ALSO import `dropDynamicView`. Find the line importing `dropFilterView` from `"../api/client"` and add `dropDynamicView` next to it.

    2. In the DashboardOpen cleanup useEffect (currently lines 392-416), add the 6th-store block AFTER `useSpatialFilterStore.getState().reset()` (line 414) and BEFORE the closing `};` of the cleanup return. Concrete insertion (VERBATIM — same shape as App.tsx Task 2):

    ```typescript
          useSpatialFilterStore.getState().reset();
          // Phase 33 DV-V16-07 (6th store): snapshot materialized dynamic views BEFORE
          // reset so the loop can read entry IDs. Only `status === "materialized"` entries
          // have a live Kinetica view to drop. Fire-and-forget — never blocks dashboard switch.
          // Dashboard-A dynamic views MUST NOT leak into dashboard-B (mirrors the v1.4 + v1.5
          // session-only stores cleanup invariant).
          const dynamicViews = useDynamicViewStore.getState().views;
          for (const idStr of Object.keys(dynamicViews)) {
            const dvId = Number(idStr);
            if (dynamicViews[dvId]?.status === "materialized") {
              dropDynamicView(dvId).catch(() => {});
            }
          }
          useDynamicViewStore.getState().reset();
        };
      }, [dashboard.id]);
    ```

    The canonical 6-store reset order at DashboardOpen unmount now matches App.tsx:

    ```
    filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore →
    spatialFilterStore → dynamicViewStore (6th, last)
    ```

    DO NOT move any existing reset call. DO NOT reorder.

    3. Extend `kinetica_bi/src/components/DashboardsPage.spec.tsx`. Mirror Task 2's spec extensions but at the DashboardOpen unmount site:

    a. Add `dropDynamicView` to the vi.mock("../api/client") block (currently around line 60-78). Concrete:

    ```typescript
    vi.mock("../api/client", async (importOriginal) => {
      const original = await importOriginal<typeof import("../api/client")>();
      return {
        ...original,
        dropFilterView: vi.fn(() => Promise.resolve({ dropped: true as const })),
        // ADD THIS LINE:
        dropDynamicView: vi.fn(() => Promise.resolve({ dropped: true as const })),
        listDashboards: vi.fn(() => Promise.resolve([])),
        listWidgets: vi.fn(() => Promise.resolve([])),
        listViews: vi.fn(() => Promise.resolve([])),
        listDashboardTables: vi.fn(() => Promise.resolve([])),
      };
    });

    // ALSO update the named import block:
    import { dropFilterView, dropDynamicView, listDashboards, listWidgets, listViews, listDashboardTables } from "../api/client";
    import { useDynamicViewStore } from "../store/dynamicViewStore";
    ```

    Add to existing `beforeEach`:
    ```typescript
    (dropDynamicView as ReturnType<typeof vi.fn>).mockClear();
    (dropDynamicView as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve({ dropped: true as const }));
    ```

    b. Add new test cases mirroring App.spec.tsx's new tests (Task 2 step 4), but for DashboardOpen unmount instead of UNAUTHORIZED. Required tests:

    ```typescript
    it("fires dropDynamicView for each MATERIALIZED entry on DashboardsPage unmount (and only materialized)", async () => {
      useDynamicViewStore.getState().setView(10, { viewName: "_kbi_dv_mat", status: "materialized", expiresAt: Date.now() + 60000 });
      useDynamicViewStore.getState().markPending(11, "_kbi_dv_pending");
      useDynamicViewStore.getState().setError(12, "boom");
      useDynamicViewStore.getState().setView(13, { viewName: "_kbi_dv_over", status: "over_threshold", reason: "no_filter" });

      // Mount DashboardsPage in dashboard-view mode, then unmount (mirrors existing test setup
      // at DashboardsPage.spec.tsx line 86-110 — "fires dropFilterView for each active view...").
      // ... use existing render+unmount pattern

      // Only materialized entry triggers drop.
      expect(dropDynamicView).toHaveBeenCalledTimes(1);
      expect(dropDynamicView).toHaveBeenCalledWith(10);
      expect(dropDynamicView).not.toHaveBeenCalledWith(11);
      expect(dropDynamicView).not.toHaveBeenCalledWith(12);
      expect(dropDynamicView).not.toHaveBeenCalledWith(13);

      // Store reset.
      expect(useDynamicViewStore.getState().views).toEqual({});
      expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
    });

    it("all 6 stores reset on DashboardsPage unmount (canonical order — 6th store added)", async () => {
      // Seed each of the 6 stores with at least one entry/value.
      useFilterViewStore.getState().setView(99, { viewName: "_kbi_filt_v1", expiresAt: Date.now() + 60000 }, 5);
      // ... (existing seeds for the other 4 stores)
      useDynamicViewStore.getState().setView(10, { viewName: "_kbi_dv_mat", status: "materialized", expiresAt: Date.now() + 60000 });

      // Mount + unmount DashboardsPage.
      // ... existing render+unmount pattern

      // Assert all 6 stores fully reset.
      expect(useFilterViewStore.getState().views).toEqual({});
      expect(useFilterStore.getState().filters).toEqual([]); // adapt to actual filterStore shape
      expect(useInfoSelectionStore.getState().state).toEqual({});
      expect(useLastInfoClickContextStore.getState().context).toBeNull(); // adapt to actual shape
      expect(useSpatialFilterStore.getState().shapes).toEqual([]);
      expect(useDynamicViewStore.getState().views).toEqual({});
      expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(0);
    });
    ```

    Also extend the existing 5-store assertion test (lines 113-155) to add the 6th-store assertion.

    4. Run the spec. Iterate until all tests pass.

    5. Run the FULL frontend vitest suite to confirm no regressions on any pre-existing spec.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx --reporter=verbose 2>&1 | tail -50</automated>
  </verify>
  <done>
    DashboardsPage.tsx DashboardOpen cleanup now invokes 6 stores' reset() in canonical order, with the materialized-only DROP loop snapshotted before reset. Spec covers all 4 invariants. Full frontend suite green.
  </done>
  <acceptance_criteria>
    - `grep -nE "useDynamicViewStore" kinetica_bi/src/components/DashboardsPage.tsx | wc -l` returns at least 2 (import + .getState() calls).
    - `grep -nE "useDynamicViewStore.getState\\(\\).reset\\(\\)" kinetica_bi/src/components/DashboardsPage.tsx` returns exactly 1 line.
    - `grep -nE "dropDynamicView" kinetica_bi/src/components/DashboardsPage.tsx | wc -l` returns at least 2 (import + invocation).
    - `grep -nE 'status === "materialized"' kinetica_bi/src/components/DashboardsPage.tsx | wc -l` returns at least 1 (DROP loop filter).
    - `grep -nE "dropDynamicView\\(.*\\)\\.catch\\(\\(\\) => \\{\\}\\)" kinetica_bi/src/components/DashboardsPage.tsx | wc -l` returns at least 1 (fire-and-forget).
    - 6-store reset order: `awk '/getState\(\)\.reset\(\)/' kinetica_bi/src/components/DashboardsPage.tsx | head -6` — the 6th line must contain `useDynamicViewStore`.
    - `grep -nE "useDynamicViewStore" kinetica_bi/src/components/DashboardsPage.spec.tsx | wc -l` returns at least 3.
    - `grep -nE "dropDynamicView" kinetica_bi/src/components/DashboardsPage.spec.tsx | wc -l` returns at least 4.
    - `cd kinetica_bi && npx vitest run src/components/DashboardsPage.spec.tsx` exits 0 with existing tests still green + at least 2 new tests for the 6th store.
    - `cd kinetica_bi && npx vitest run` (full frontend suite) exits 0 — no regression.
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

</tasks>

<verification>
After all 3 tasks complete, run the full frontend vitest + tsc + server vitest:

```bash
cd kinetica_bi && npx vitest run --reporter=verbose 2>&1 | tail -30
cd kinetica_bi && npx tsc --noEmit
cd kinetica_bi/server && npx vitest run --reporter=verbose 2>&1 | tail -20
cd kinetica_bi/server && npx tsc --noEmit
```

Expected:
- Frontend vitest: 7 new client helpers' tests passing, App.spec.tsx + DashboardsPage.spec.tsx extended assertions passing. No regressions.
- Server vitest: unchanged from Plan 33-02 (this plan does NOT touch server code).
- Both tsc clean.
</verification>

<success_criteria>
- 7 client helpers (`listDynamicViews`, `createDynamicView`, `updateDynamicView`, `deleteDynamicView`, `previewDynamicView`, `materializeDynamicView`, `dropDynamicView`) exported from `client.ts` with full type signatures + AbortSignal threading + PURE PASS-THROUGH (zero store imports).
- `materializeDynamicView` response is a discriminated union by `status` with 3 branches.
- App.tsx UNAUTHORIZED handler resets all 6 stores in canonical order (filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore → spatialFilterStore → dynamicViewStore) and fires DROP loop for materialized-only entries.
- DashboardsPage.tsx DashboardOpen cleanup mirrors the same 6-store + DROP loop pattern.
- DROP loop is snapshot-before-reset (proven by spec) and fire-and-forget (.catch(()=>{})).
- App.spec.tsx + DashboardsPage.spec.tsx + client.spec.ts extended with all required assertions.
- Full frontend vitest + tsc green; no regressions on prior plans' specs.
</success_criteria>

<output>
After completion, create `.planning/phases/33-dynamic-view-store/33-03-SUMMARY.md` documenting:
- Final 7-helper export list + their TypeScript signatures + their response shapes (operator-facing contract reference for Phase 34's modal + Phase 35's renderer).
- The verbatim 6-store reset order + the DROP loop placement at both lifecycle sites (so Phase 34/35 readers know how to expect store state at logout / dashboard switch).
- Test counts (per modified spec file, total new, full-suite still-green count).
- Any decisions made under Claude's discretion (e.g., `dropDynamicView` AbortSignal threading kept for consistency even though callsite is fire-and-forget; spec organization style).
- Hand-off pointers for Phase 34 (which helpers to import for create/edit/preview/delete UI flow) and Phase 35 (markPending → materialize → setView trigger chain pattern with the discriminated-union response).
</output>
