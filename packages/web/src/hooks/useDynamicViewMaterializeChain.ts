/**
 * Phase 35 (DV-V16-13): Dashboard-scope orchestrator hook for dynamic-view
 * cascading materialize.
 *
 * Subscribes to `useFilterViewStore.views[T]?.materializeVersion` for each unique
 * source-table referenced by the dashboard's dynamic-views. On materializeVersion
 * bump for table T, fires `markPending → materializeDynamicView → setView/setError`
 * for each dv with `source_table_id === T`.
 *
 * Key behaviors (locked — see 35-CONTEXT.md + 35-RESEARCH.md):
 * - Cold-start gate (Pitfall 1): cascade fires ONLY when `matVer > 0` — prevents
 *   N materialize calls on dashboard mount before any filter is applied. The
 *   guard `matVer === undefined || matVer === 0` short-circuits both the
 *   uninitialized case and the `markMaterializing`-placeholder case
 *   (filterViewStore writes `materializeVersion: 0` at line 94).
 * - Per-dv AbortController in `useRef<Map<number, AbortController>>` — rapid
 *   filter changes abort prior in-flight materialize for THE SAME dv;
 *   cross-dv isolation preserved (different dvs never cancel each other).
 * - List refresh on `dynamicViewVersion` increment (Phase 33 locked option b).
 *   AbortController on the list-fetch is cancelled on unmount + on every
 *   dynamicViewVersion bump.
 * - Pitfall 2 cleanup: controllers for dvs no longer in the list are aborted
 *   and pruned from the Map after every cascade-effect fire.
 * - AbortError silent; other errors → setError + toast kind "error"
 *   (the only failure kind in the locked Phase 34 ToastKind union).
 * - Returns `{ dynamicViews, retry(id) }` — Plan 35-05 consumes retry for
 *   renderer error states; Plans 35-04/35-06 consume dynamicViews via prop
 *   threading through WidgetConfigModal / LayersModal.
 *
 * Mount site: `DashboardsPage.tsx` `DashboardOpen` body. Single instance per
 * open dashboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFilterViewStore } from "../store/filterViewStore";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { buildDynamicViewName } from "../lib/dynamicViewName";
import {
  listDynamicViews,
  materializeDynamicView,
  type DynamicViewRow,
} from "../api/client";

export type UseDynamicViewMaterializeChainResult = {
  dynamicViews: DynamicViewRow[];
  retry: (dynamicViewId: number) => void;
};

export function useDynamicViewMaterializeChain(
  dashboardId: number,
): UseDynamicViewMaterializeChainResult {
  // --- 1. List state — refreshes on mount + when dynamicViewVersion increments ---
  const [dynamicViews, setDynamicViews] = useState<DynamicViewRow[]>([]);
  const dynamicViewVersion = useDynamicViewStore((s) => s.dynamicViewVersion);
  const listAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listAbortRef.current?.abort();
    const ctrl = new AbortController();
    listAbortRef.current = ctrl;
    listDynamicViews(dashboardId, ctrl.signal)
      .then(({ dynamic_views }) => {
        if (!ctrl.signal.aborted) setDynamicViews(dynamic_views);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        // Soft-fail — operator can still use widgets; cascades just won't fire.
        // No toast: list-fetch failure is non-critical and not user-actionable here.
      });
    return () => ctrl.abort();
  }, [dashboardId, dynamicViewVersion]);

  // --- 2. Stable primitive key for filter-view materializeVersion subscription ---
  //     (PITFALL S-02): subscribe via a sorted, primitive string — not the whole
  //     `views` object. Selector identity is stable when underlying versions don't change.
  const sourceTableIds = useMemo(
    () =>
      Array.from(new Set(dynamicViews.map((dv) => dv.source_table_id))).sort(
        (a, b) => a - b,
      ),
    [dynamicViews],
  );
  const matVersionKey = useFilterViewStore((s) =>
    sourceTableIds
      .map((tid) => `${tid}:${s.views[tid]?.materializeVersion ?? 0}`)
      .join(","),
  );

  // --- 3. Per-dv AbortController Map (cross-dv isolation; survives re-renders) ---
  const cascadeControllersRef = useRef<Map<number, AbortController>>(new Map());

  // --- 3b. Per-dv last-seen matVer — prevents re-firing dv-A's cascade when an
  //     unrelated dv-B's source-table matVer bumps the matVersionKey (cross-dv
  //     isolation lock — Test 7). The cascade fires for dv X only when X's
  //     source-table matVer is strictly greater than the last value we acted on.
  const lastSeenMatVerRef = useRef<Map<number, number>>(new Map());

  // --- 4. Cascade fire helper — shared by the effect and the retry callback.
  //     `force=true` (retry path) skips the gate so the renderer's Retry button
  //     always re-fires even when nothing has changed.
  //
  //     Gate logic (post-VERIFY: filter-cleared transition fix):
  //       - lastSeen = last known matVer for THIS dv (0 if never seen, tracked via
  //         a separate `hasInitialized` Set so we can distinguish "never fired"
  //         from "fired with matVer=0").
  //       - currentMatVer = current matVer in store (0 if entry missing / cleared).
  //
  //     Cases this gates:
  //       (a) Dashboard mount, no filter (cur=0, never-fired)   → FIRE (no_filter path)
  //                                                                — populates dv store
  //                                                                  with over_threshold/
  //                                                                  no_filter so renderers
  //                                                                  show empty state
  //                                                                  immediately (NOT
  //                                                                  loading-stuck) and
  //                                                                  map layers' buildWms
  //                                                                  params correctly
  //                                                                  return null (skip).
  //       (b) Already-fired no-filter steady (cur=0, last=0)    → SKIP — already at correct
  //                                                                  state
  //       (c) First filter applied        (cur=5, last=0)       → FIRE
  //       (d) Filter bumped               (cur=6, last=5)       → FIRE
  //       (e) Filter cleared              (cur=0, last=5)       → FIRE — server returns
  //                                                                  no_filter, drops dv
  //       (f) Re-filter after clear       (cur=7, last=0)       → FIRE
  //
  //     Cross-dv isolation: dv-A's source-table bump that doesn't touch dv-B's
  //     source-table leaves dv-B's matVer unchanged → SKIP unless dv-B has
  //     never-fired (case a).
  //
  //     no_filter fast-path optimization: when currentMatVer===0 we KNOW the
  //     server would return {status:"over_threshold", reason:"no_filter"} (its
  //     no_filter probe is deterministic from client state — the absence of a
  //     filterViewStore entry corresponds 1:1 to the server-side
  //     buildFilterViewName lookup miss). Setting the store directly avoids
  //     N parallel HTTP round-trips on dashboard mount (5 dvs × no_filter
  //     responses) while delivering the same end state.
  const fireCascade = useCallback((dv: DynamicViewRow, force = false) => {
    const username = useAuthStore.getState().user?.username;
    if (!username) return; // Test 17: no username → defensive short-circuit

    const matVer = useFilterViewStore.getState().views[dv.source_table_id]
      ?.materializeVersion;
    const currentMatVer = matVer ?? 0;
    const hasInitialized = lastSeenMatVerRef.current.has(dv.id);
    if (!force) {
      // Skip only when we've already initialized AND the value hasn't changed.
      // First-time-seen-this-dv always fires (initial state discovery).
      if (hasInitialized) {
        const lastSeen = lastSeenMatVerRef.current.get(dv.id) ?? 0;
        if (currentMatVer === lastSeen) return;
      }
    }
    lastSeenMatVerRef.current.set(dv.id, currentMatVer);

    // no_filter fast-path: deterministic from client state — skip the HTTP
    // round-trip. Server's no_filter detection is identical to the absence of
    // an in-store filterViewStore entry, so we can authoritatively set the dv
    // store from here without any race. Abort any in-flight cascade for this dv
    // (e.g. a stale materialize from a recent filter that the operator just
    // cleared) so we don't overwrite our authoritative no_filter state with a
    // late response.
    //
    // Retry (`force=true`) bypasses the fast-path. The renderer Retry button
    // is an operator-driven confirmation gesture: even when the client KNOWS
    // the answer is no_filter, we honor the explicit intent and round-trip
    // the server. This also catches the edge case where client and server
    // state have drifted (e.g. the server's filter view exists but the
    // client's filterViewStore entry was reset).
    if (!force && currentMatVer === 0) {
      cascadeControllersRef.current.get(dv.id)?.abort();
      cascadeControllersRef.current.delete(dv.id);
      const viewName = buildDynamicViewName({
        userId: username,
        dashboardId: dv.dashboard_id,
        dynamicViewId: dv.id,
      });
      useDynamicViewStore.getState().setView(dv.id, {
        viewName,
        status: "over_threshold",
        reason: "no_filter",
      });
      return;
    }

    // Abort prior in-flight for THIS dv only (cross-dv isolation — Test 7).
    cascadeControllersRef.current.get(dv.id)?.abort();
    const ctrl = new AbortController();
    cascadeControllersRef.current.set(dv.id, ctrl);

    const viewName = buildDynamicViewName({
      userId: username,
      dashboardId: dv.dashboard_id,
      dynamicViewId: dv.id,
    });
    useDynamicViewStore.getState().markPending(dv.id, viewName);

    materializeDynamicView(dv.id, ctrl.signal)
      .then((result) => {
        if (ctrl.signal.aborted) return;
        if (result.status === "materialized") {
          useDynamicViewStore.getState().setView(dv.id, {
            viewName: result.view_name,
            status: "materialized",
            expiresAt: result.expires_at,
          });
        } else if (result.status === "over_threshold") {
          useDynamicViewStore.getState().setView(dv.id, {
            viewName,
            status: "over_threshold",
            reason: result.reason,
          });
        }
        // No toast on success — locked from Phase 34 research. Over-threshold is
        // surfaced via renderer empty state (Plan 35-05) and map overlay (Plan 35-06).
      })
      .catch((err) => {
        // Silence ANY rejection that arrives after our controller was aborted —
        // covers both native AbortError and the late-rejection-during-unmount race
        // (where the hook is torn down between materializeDynamicView's call and
        // the rejection's microtask).
        if (ctrl.signal.aborted) return;
        if ((err as Error)?.name === "AbortError") return; // Test 12: silent
        const msg = (err as Error).message ?? "Materialize failed";
        useDynamicViewStore.getState().setError(dv.id, msg);
        // Toast kind LOCKED to "error" — the only failure kind in the Phase 34
        // ToastKind union ("permission" | "info" | "error"). NO non-error kinds.
        useToastStore.getState().showToast(`Materialize failed: ${msg}`, "error");
      });
  }, []);

  // --- 5. Cascade effect — fires on matVersionKey OR dynamicViews change ---
  useEffect(() => {
    for (const dv of dynamicViews) {
      fireCascade(dv);
    }

    // PITFALL 2 cleanup: prune controllers + last-seen entries for dvs no
    // longer in the list (e.g., after a delete).
    const activeIds = new Set(dynamicViews.map((dv) => dv.id));
    for (const [id, ctrl] of cascadeControllersRef.current.entries()) {
      if (!activeIds.has(id)) {
        ctrl.abort();
        cascadeControllersRef.current.delete(id);
      }
    }
    for (const id of lastSeenMatVerRef.current.keys()) {
      if (!activeIds.has(id)) lastSeenMatVerRef.current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matVersionKey, dynamicViews, fireCascade]);

  // --- 6. Unmount cleanup: abort all in-flight cascades ---
  useEffect(
    () => () => {
      cascadeControllersRef.current.forEach((c) => c.abort());
      cascadeControllersRef.current.clear();
    },
    [],
  );

  // --- 7. Retry callback for renderer error states (Plan 35-05 consumes).
  //     Force-fires regardless of last-seen matVer / cold-start gate so the
  //     renderer's Retry button always re-attempts. AbortController dedup still
  //     applies (per-id Map ensures rapid retry-clicks don't pile in-flight).
  const retry = useCallback(
    (dynamicViewId: number) => {
      const dv = dynamicViews.find((d) => d.id === dynamicViewId);
      if (!dv) return;
      fireCascade(dv, true);
    },
    [dynamicViews, fireCascade],
  );

  return { dynamicViews, retry };
}
