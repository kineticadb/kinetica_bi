# Phase 78: View TTL Keep-Alive Touch - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Source:** Autonomous run — decisions by Claude per operator's "execute 75–78 without my input" directive. All design choices surfaced here for later review.

<domain>
## Phase Boundary

A FRONTEND-ONLY dashboard-level client hook that, while a dashboard is open, fires a lightweight "get first records" READ ("touch") against each LIVE materialized view (filter-views + dynamic-views) a configurable lead-time (`ttlKeepaliveLeadMinutes`, from Phase 74 via `/api/me`) before that view's `expiresAt`, re-arms after each touch, and tears down cleanly on dashboard switch / unmount.

**In scope:** the keep-alive hook + its mount in DashboardOpen + scheduling/re-arm/teardown + the sole-materialize-trigger static guard + tests.
**NOT in scope:**
- **Live confirmation that a read actually resets Kinetica's TTL** — that is **TTLKEEP-V115-02 / Phase 79** (requires live Kinetica; cannot be done here, and this environment cannot run live Kinetica SQL anyway). This phase ASSUMES a read resets the sliding TTL (the documented behavior) and implements accordingly; the re-materialize fallback is Phase 79's concern.
- Any server change (uses the existing `/api/sql` read-path). Any materialize/drop call (the touch is READ-ONLY).

</domain>

<decisions>
## Implementation Decisions

### The hook + mount
- New hook `useViewKeepAlive` (name at planner's discretion) under `packages/web/src/hooks/`, mounted in DashboardOpen alongside `useDynamicViewMaterializeChain` (`DashboardsPage.tsx:~405-415`). Mirror that hook's structure: `useRef<Map<...>>` for per-view timers + per-view AbortControllers, primitive-selector store subscriptions, and an empty-deps unmount effect that clears all timers + aborts all in-flight reads.

### What counts as a "live view" to touch
- **Filter-views:** enumerate `useFilterViewStore.views` (Record<tableId, entry>); a view is touchable when it has a real `viewName` and an `expiresAt > 0` (skip `expiresAt===0` placeholders from `markMaterializing`). Subscribe to `materializeVersion`/the store's version so the schedule re-syncs when views change.
- **Dynamic-views:** enumerate `useDynamicViewStore.views` (Record<dvId, entry>); touchable only when `status === "materialized"` and `expiresAt` is set. Subscribe to `dynamicViewVersion`.

### The touch
- A lightweight READ via the existing `runSql(sql, {}, signal)` (`client.ts:172`): `SELECT 1 FROM ${viewName} LIMIT 1` (or `SELECT * ... LIMIT 1` — planner's choice; the point is a minimal read against the view's `viewName`). One AbortController per in-flight touch, pruned on resolve; abort prior in-flight touch for the same view before issuing a new one.
- The hook MUST NOT import or call `materializeFilter` / `materializeDynamicView` / `dropFilterView` / `fromSwap` — it is read-only. `AggregatedWidgetRenderer` remains the SOLE materialize trigger (static-import assertion, see below).
- Touch failures are swallowed (`.catch(() => {})`) — a failed/expired-view touch must never throw into the dashboard; existing reactive view-not-found recovery (WidgetRenderer / MapChartRenderer) handles real expiry. The keep-alive is best-effort.

### Scheduling + RE-ARM (the critical design point)
- **Trap:** a touch READ does NOT return a new `expiresAt`; the store's `expiresAt` stays fixed after a touch. So a naive "fire at `expiresAt - lead`" timer would immediately want to re-fire (now > expiresAt - lead) → tight loop. The re-arm must NOT key off the unchanged stored `expiresAt`.
- **Design:** for each live view, capture a window length `W` ≈ `expiresAt - Date.now()` at the moment the view is first observed live (a freshly materialized view's remaining life ≈ its full TTL). Then:
  1. **First touch** scheduled at `max(expiresAt - leadMs - Date.now(), MIN_DELAY)` from now (satisfies "fires `ttlKeepaliveLeadMinutes` before `expiresAt`"). If already within the lead window, fire soon (after `MIN_DELAY`).
  2. **Re-arm:** after a touch fires (assume it reset the server's sliding TTL), schedule the next touch `max(W - leadMs, MIN_INTERVAL)` later. `W - leadMs` is a stable interval, so the view keeps getting touched ~`lead` before each successive (assumed-reset) expiry — satisfies "re-arm across multiple TTL windows."
- `leadMs = ttlKeepaliveLeadMinutes * 60_000`, read from `useAuthStore.getState().ttlKeepaliveLeadMinutes` (Phase 74; default 1).
- **Clamps (safety):** a `MIN_INTERVAL` floor (e.g. 30s — planner picks a sane value) so a pathologically small TTL can't hammer the server; if `leadMs >= W`, touch on the `MIN_INTERVAL` cadence. Document the chosen constants.
- **Re-sync:** when the store version counter bumps (a view re-materializes → new `expiresAt`/`viewName`, or a view appears/disappears), recompute schedules — clear the old timer for that view and re-arm from the new `expiresAt`. Views that disappear (cleared/expired/over-threshold) have their timer cleared + controller aborted.

### Teardown
- On dashboard switch / unmount: clear ALL per-view timers and abort ALL in-flight touch controllers (empty-deps cleanup effect, mirroring `useDynamicViewMaterializeChain`'s teardown). No orphaned timer may fire against a closed dashboard's views.

### Claude's Discretion
- Exact hook name, the per-view key strategy (tableId for filter-views, dvId for dynamic-views — keep the two maps separate or namespace the keys), the `MIN_DELAY`/`MIN_INTERVAL` constant values, and the touch SQL form.
- Whether to capture `W` per-view-observation in a ref vs recompute; how to test timers (vitest fake timers).
- Whether to read `ttlKeepaliveLeadMinutes` once per schedule computation or subscribe (it's deploy-config, effectively constant per session — a `getState()` snapshot at schedule time is fine).

</decisions>

<specifics>
## Specific Ideas

- Mirror `useDynamicViewMaterializeChain` end-to-end for mount + per-view ref maps + teardown — it's the established dashboard-level orchestration-hook pattern.
- Best-effort semantics: the keep-alive never surfaces errors; reactive view-not-found recovery already exists for real expiry.
- The "assume read resets TTL" premise is explicitly Phase 79's to confirm live; build to that premise now.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Mount precedent + teardown pattern
- `packages/web/src/hooks/useDynamicViewMaterializeChain.ts:52-279` — per-view `useRef<Map<number, AbortController>>` (`:93`), per-view last-seen ref (`:99`), primitive-selector subscription (`:79-90`), empty-deps unmount teardown (`:256-263`). Mirror for the keep-alive hook.
- `packages/web/src/components/DashboardsPage.tsx:405-415` — DashboardOpen mount site (mount the keep-alive hook here); cleanup effect at `:514`.

### Stores (live-view enumeration + expiresAt + version counters)
- `packages/web/src/store/filterViewStore.ts:30-59` — `FilterViewEntry { viewName, expiresAt (epoch ms), materializing, materializeVersion, dashboardId }`; `views: Record<tableId, entry>`.
- `packages/web/src/store/dynamicViewStore.ts:49-77` — entry `{ viewName, status, expiresAt? }`; `views: Record<dvId, entry>`; global `dynamicViewVersion`.
- `packages/web/src/lib/viewExpiry.ts:23` — `isViewExpired(entry)` (`Date.now() >= entry.expiresAt`; `expiresAt===0` = placeholder/expired). Reuse for "is this a real live view" checks; complement, don't duplicate.

### Touch read-path + lead-time source
- `packages/web/src/api/client.ts:172-189` — `runSql<T>(sql, options?, signal?)`. Read-only; AbortSignal threaded. The touch uses this. (NO materialize import.)
- `packages/web/src/store/auth.ts:14-46` — `ttlKeepaliveLeadMinutes` (default 1, set from `/api/me`); read via `useAuthStore.getState().ttlKeepaliveLeadMinutes`.

### Sole-materialize-trigger guard
- `packages/web/src/components/charts/DataFilterRenderer.spec.tsx:609-620` — static-import-assertion example. Add an equivalent test for the keep-alive hook asserting it imports NO `materializeFilter`/`materializeDynamicView`/`dropFilterView`/`fromSwap`.

### Requirements
- `.planning/REQUIREMENTS.md` — TTLKEEP-V115-01 (this phase: touch + re-arm + idle dashboards never hit expired views). TTLKEEP-V115-02 (Phase 79: live TTL-reset confirmation — NOT this phase).
- Phase 74 (`74-CONTEXT.md`) — provides `ttlKeepaliveLeadMinutes` on `/api/me` + the auth-store field.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useDynamicViewMaterializeChain` — the dashboard-level hook template (refs/teardown/subscription).
- `runSql` — the read primitive for the touch.
- `useAuthStore.ttlKeepaliveLeadMinutes` — Phase 74 lead-time.
- `filterViewStore` / `dynamicViewStore` — already track `viewName` + `expiresAt` + version counters.
- `isViewExpired` (`viewExpiry.ts`) — live/placeholder check.

### Established Patterns
- Dashboard-level orchestration hooks mounted in DashboardOpen with per-view ref maps + empty-deps teardown.
- AbortController-per-request, prune-on-resolve, abort-prior-in-flight.
- Primitive version-counter selectors trigger recompute (materializeVersion / dynamicViewVersion).
- Static-import grep tests lock the sole-materialize-trigger invariant.
- Best-effort background ops swallow errors; reactive recovery handles real failures.

### Integration Points
- New hook file under `packages/web/src/hooks/` + its spec.
- Mounted in `DashboardsPage.tsx` DashboardOpen.
- Reads filterViewStore + dynamicViewStore + auth store; calls `runSql`. No server change, no materialize.

</code_context>

<deferred>
## Deferred Ideas

- **Live confirmation that a read resets Kinetica's TTL** + the re-materialize fallback if it does not — **Phase 79 (TTLKEEP-V115-02)**. This phase builds to the "read resets TTL" premise.
- Server-driven keep-alive / push-based TTL extension — out of scope; client-touch is the chosen mechanism.
- Surfacing keep-alive status in the UI — not needed; it's a silent background safety net.

</deferred>

---

*Phase: 78-view-ttl-keep-alive-touch*
*Context gathered: 2026-06-20 (autonomous)*
