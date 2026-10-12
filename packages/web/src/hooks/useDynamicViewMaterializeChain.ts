/**
 * Phase 35 (DV-V16-13) + quick-261009-jg6: dashboard-scope hook for dynamic-view
 * cascading materialize.
 *
 * Driven by `filterVersion` + `filterCombinationStore` readiness (NOT the legacy
 * filterViewStore, whose materializeVersion has been dead since v1.18). For each dv:
 *   - hash = currentDvSourceComboHash(source_table_id, widgets) (column filters + spatial draws) -- the
 *     combination useCombinationOrchestrator materializes + ref-counts under `dv:<id>`.
 *   - token = "nofilter" | "wait:<hash>" (registry entry absent/materializing)
 *             | "ready:<hash>:<viewName>:<expiresAt>:<materializeVersion>".
 *   - The cascade fires only when the token CHANGES (or on retry/force).
 *
 * Sole-trigger invariant: this hook never calls materializeFilter; it only READS the
 * registry and sends the hash to POST /api/dynamic-view/materialize as combination_key.
 *
 * Key behaviors:
 * - Per-dv AbortController in `useRef<Map<number, AbortController>>` -- a token change
 *   aborts the prior in-flight materialize for THE SAME dv; cross-dv isolation preserved.
 * - List refresh on `dynamicViewVersion` increment (Phase 33 locked option b).
 * - Controllers for dvs no longer in the list are aborted and pruned.
 * - AbortError silent; other errors -> setError + toast kind "error".
 * - If the orchestrator's materialize of the dv source combination fails, the
 *   orchestrator sets the dv status to `error` (this hook leaves it alone: the token
 *   stays `wait:<hash>`), so the chain is never stuck in `pending`.
 * - Returns `{ dynamicViews, retry(id) }`.
 *
 * Mount site: `DashboardsPage.tsx` `DashboardOpen` body. Single instance per open dashboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useFilterStore } from "../store/filterStore";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useFilterCombinationStore } from "../store/filterCombinationStore";
import { currentDvSourceComboHash } from "../lib/dvSourceCombo";
import { useDynamicViewStore } from "../store/dynamicViewStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { buildDynamicViewName } from "../lib/dynamicViewName";
import {
  listDynamicViews,
  materializeDynamicView,
  type DynamicViewRow,
  type WidgetDto,
} from "../api/client";

export type UseDynamicViewMaterializeChainResult = {
  dynamicViews: DynamicViewRow[];
  retry: (dynamicViewId: number) => void;
};

const NO_WIDGETS: WidgetDto[] = [];

export function useDynamicViewMaterializeChain(
  dashboardId: number,
  // Dashboard widgets: only used to resolve each source table's eligible spatial target (map
  // widgets' spatialTargets) so the hash matches the orchestrator's. Omitted => column-only.
  widgets: WidgetDto[] = NO_WIDGETS,
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

  // --- 2. Primitive subscriptions only (PITFALL S-02). filterVersion bumps on every filter
  //     change; combinationVersion bumps on every registry mutation (the orchestrator's
  //     setEntry flips a `wait` token to `ready`). Per-dv tokens below dedupe the re-fires.
  const filterVersion = useFilterStore((s) => s.filterVersion);
  // spatialFilterVersion: a spatial-only draw/clear changes the dv source combination (no
  // filterVersion bump). Bumps only on draw/remove/clear, never on registry writes -> no loop.
  const spatialFilterVersion = useSpatialFilterStore((s) => s.spatialFilterVersion);
  const combinationVersion = useFilterCombinationStore((s) => s.combinationVersion);

  // --- 3. Per-dv AbortController Map (cross-dv isolation; survives re-renders) ---
  const cascadeControllersRef = useRef<Map<number, AbortController>>(new Map());

  // --- 3b. Per-dv last-seen token -- prevents re-firing dv-A when an unrelated
  //     registry mutation (combinationVersion bump) leaves dv-A's token unchanged.
  const lastTokenRef = useRef<Map<number, string>>(new Map());

  const widgetsRef = useRef<WidgetDto[]>(widgets);
  widgetsRef.current = widgets;

  // --- 4. Cascade fire helper -- shared by the effect and the retry callback.
  //     `force=true` (retry path) skips the token gate and the no_filter fast-path so the
  //     renderer's Retry / "Load full table" always reaches the server.
  //
  //     Token cases (see header):
  //       nofilter + capped (max_records > 0)  -> local over_threshold/no_filter fast-path
  //                                               (mount-time HTTP saving only: since v1.18 a
  //                                               no-filter dv can only take the server's base
  //                                               branch; not a correctness shortcut)
  //       nofilter + Unlimited (max_records 0) -> server call, no key -> base-table aggregate
  //       wait                                  -> markPending, NO HTTP; the orchestrator's
  //                                               setEntry bumps combinationVersion and the
  //                                               token turns `ready`
  //       ready                                 -> server call with combination_key = hash
  const fireCascade = useCallback((dv: DynamicViewRow, force = false) => {
    const username = useAuthStore.getState().user?.username;
    if (!username) return; // Test 17: no username → defensive short-circuit

    const hash = currentDvSourceComboHash(dv.source_table_id, widgetsRef.current);
    const entry = hash ? useFilterCombinationStore.getState().registry[hash] : undefined;
    const ready = !!entry && !entry.materializing && entry.viewName !== "";
    const token =
      hash === undefined
        ? "nofilter"
        : ready
          ? `ready:${hash}:${entry!.viewName}:${entry!.expiresAt}:${entry!.materializeVersion}`
          : `wait:${hash}`;
    if (!force && lastTokenRef.current.get(dv.id) === token) return;
    lastTokenRef.current.set(dv.id, token);

    const viewName = buildDynamicViewName({
      userId: username,
      dashboardId: dv.dashboard_id,
      dynamicViewId: dv.id,
    });

    // no_filter fast-path (capped dvs only). Abort any in-flight cascade for this dv so a
    // late response cannot overwrite the authoritative no_filter state.
    if (!force && token === "nofilter" && dv.max_records > 0) {
      cascadeControllersRef.current.get(dv.id)?.abort();
      cascadeControllersRef.current.delete(dv.id);
      useDynamicViewStore.getState().setView(dv.id, {
        viewName,
        status: "over_threshold",
        reason: "no_filter",
      });
      return;
    }

    // Filter set but its combination view is not ready yet: wait for the orchestrator.
    if (!force && token.startsWith("wait:")) {
      cascadeControllersRef.current.get(dv.id)?.abort();
      cascadeControllersRef.current.delete(dv.id);
      useDynamicViewStore.getState().markPending(dv.id, viewName);
      return;
    }

    // Abort prior in-flight for THIS dv only (cross-dv isolation — Test 7).
    cascadeControllersRef.current.get(dv.id)?.abort();
    const ctrl = new AbortController();
    cascadeControllersRef.current.set(dv.id, ctrl);

    useDynamicViewStore.getState().markPending(dv.id, viewName);

    materializeDynamicView(dv.id, ctrl.signal, hash)
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

  // --- 5. Cascade effect -- fires on filterVersion / combinationVersion / dynamicViews change ---
  useEffect(() => {
    for (const dv of dynamicViews) {
      fireCascade(dv);
    }

    // PITFALL 2 cleanup: prune controllers + last-token entries for dvs no
    // longer in the list (e.g., after a delete).
    const activeIds = new Set(dynamicViews.map((dv) => dv.id));
    for (const [id, ctrl] of cascadeControllersRef.current.entries()) {
      if (!activeIds.has(id)) {
        ctrl.abort();
        cascadeControllersRef.current.delete(id);
      }
    }
    for (const id of lastTokenRef.current.keys()) {
      if (!activeIds.has(id)) lastTokenRef.current.delete(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterVersion, spatialFilterVersion, combinationVersion, dynamicViews, widgets, fireCascade]);

  // --- 6. Unmount cleanup: abort all in-flight cascades ---
  useEffect(
    () => () => {
      cascadeControllersRef.current.forEach((c) => c.abort());
      cascadeControllersRef.current.clear();
    },
    [],
  );

  // --- 7. Retry callback for renderer error states (Plan 35-05 consumes).
  //     Force-fires regardless of the last-seen token / fast-path so the
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
