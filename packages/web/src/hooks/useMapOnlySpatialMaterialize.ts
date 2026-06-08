/**
 * Phase 54 Plan 10 (TRACKFIX-V19-09 / GAP-54-10): Dashboard-scope hook that fires
 * POST /api/filter/materialize ONLY for tables shown EXCLUSIVELY on a map widget
 * (no chart/records trigger widget bound to the same tableId).
 *
 * Problem closed: MapChartRenderer is a pure consumer — it never calls materialize.
 * A table that is ONLY shown on a map (e.g., a track table) therefore never got spatial
 * filter materializations even when shapes were drawn. This hook fills that gap.
 *
 * Invariant preserved (Phase 30 sole-trigger rule): if table T already has an
 * AggregatedWidgetRenderer or RecordsTableRenderer widget, those renderers own
 * Effect 1 for T. This hook SKIPS T entirely in that case — no double-DDL.
 *
 * Double-DDL backstop: materializeFilter's in-flight dedup cache in client.ts
 * (keyed `${dashboardId}:${tableId}`) ensures that even if a concurrent WidgetRenderer
 * and this hook somehow both issue calls for T, the second caller JOINS the in-flight
 * promise rather than firing a new DDL round-trip.
 *
 * Mount site: `DashboardsPage.tsx` `DashboardOpen` body. Single instance per
 * open dashboard (next to useDynamicViewMaterializeChain).
 *
 * See: WidgetRenderer.tsx:240-272 for the dispatch table this hook mirrors.
 */

import { useEffect, useMemo, useRef } from "react";

import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useFilterStore } from "../store/filterStore";
import { useFilterViewStore } from "../store/filterViewStore";
import { useToastStore } from "../store/toast";
import { aggregateSpatialTargetsByTable } from "../lib/spatialTargets";
import { materializeFilter, dropFilterView } from "../api/client";
import type { WidgetDto, MaterializeFilterArgs } from "../api/client";

// ---------------------------------------------------------------------------
// Non-trigger widget types (pure consumers — keep in sync with WidgetRenderer.tsx:240-272).
//
// Allow-list approach: anything NOT in this set is treated as a trigger.
// This covers the explicit trigger types (records + AggregatedWidgetRenderer's
// bar/line/pie/scatter) AND any future chart types that land in the `else` default
// branch of WidgetRenderer's dispatch (AggregatedWidgetRenderer receives them).
// ---------------------------------------------------------------------------
const NON_TRIGGER_TYPES = new Set([
  "map",
  "info-card",
  "legend",
  "datafilter",
  "timeline",
  "numericline",
]);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Dashboard-scope hook that fires materializeFilter for map-only tables.
 *
 * @param dashboardId - The currently-open dashboard id.
 * @param widgets     - All widgets on the dashboard (synced from DashboardOpen state).
 */
export function useMapOnlySpatialMaterialize(
  dashboardId: number,
  widgets: WidgetDto[],
): void {
  // --- 1. Aggregate eligible spatial targets per table (map widgets only, first-win) ---
  const targetsByTable = useMemo(
    () => aggregateSpatialTargetsByTable(widgets),
    [widgets],
  );

  // --- 2. Set of tableIds that have at least one trigger widget ---
  // A widget triggers T iff: (a) widget.config.tableId === T AND
  //                           (b) widget.type is NOT in NON_TRIGGER_TYPES.
  // Using the allow-list means unknown/future chart types default to "trigger" —
  // matches WidgetRenderer's `else → AggregatedWidgetRenderer` default branch.
  const triggeredTableIds = useMemo(() => {
    const set = new Set<number>();
    for (const w of widgets) {
      if (NON_TRIGGER_TYPES.has(w.type)) continue;
      const tableId = (w.config as { tableId?: number }).tableId;
      if (typeof tableId === "number") {
        set.add(tableId);
      }
    }
    return set;
  }, [widgets]);

  // --- 3. Map-only targets: eligible targets for tables with NO trigger widget ---
  // This is the exclusive set the hook owns. Tables in triggeredTableIds are
  // fully managed by WidgetRenderer Effect 1 — we must not duplicate their DDL.
  const mapOnlyTargets = useMemo(
    () =>
      Array.from(targetsByTable.entries()).filter(
        ([tableId]) => !triggeredTableIds.has(tableId),
      ),
    [targetsByTable, triggeredTableIds],
  );

  // --- 4. Subscribe to spatialFilterVersion as a primitive dep (PITFALL S-02) ---
  // Mirrors WidgetRenderer.tsx:385 — subscribe to the version counter, not the
  // shapes array, to avoid object-identity churn and stale-closure hazards.
  const spatialFilterVersion = useSpatialFilterStore(
    (s) => s.spatialFilterVersion,
  );

  // --- 5. Per-table AbortController Map (cross-table isolation; survives re-renders) ---
  const controllersRef = useRef<Map<number, AbortController>>(new Map());

  // --- 6. Materialize effect — debounced 300ms (mirrors WidgetRenderer.tsx:403-457) ---
  useEffect(() => {
    const timer = setTimeout(async () => {
      // Read shapes imperatively (one-shot, avoids stale closure)
      const shapes = useSpatialFilterStore.getState().shapes;
      const activeTableIds = new Set(mapOnlyTargets.map(([tid]) => tid));

      for (const [tableId, target] of mapOnlyTargets) {
        const tableFilters =
          useFilterStore.getState().filters[tableId] ?? [];
        const hasShapes = shapes.length > 0;

        // DROP guard (mirrors WidgetRenderer.tsx:416-424):
        // If no column filters AND no shapes, drop any stale view and skip materialize.
        if (tableFilters.length === 0 && !hasShapes) {
          dropFilterView({ dashboardId, tableId }).catch(() => {});
          useFilterViewStore.getState().clearView(tableId);
          continue;
        }

        // Abort prior in-flight for THIS table only (cross-table isolation)
        controllersRef.current.get(tableId)?.abort();
        const controller = new AbortController();
        controllersRef.current.set(tableId, controller);

        // Mark materializing (lifts the suspend gate)
        useFilterViewStore.getState().markMaterializing(tableId, dashboardId);

        // Build args — spatial fields are always paired (both present or both absent),
        // preserving byte-parity with WidgetRenderer.tsx:434-442.
        const args: MaterializeFilterArgs = hasShapes
          ? {
              dashboardId,
              tableId,
              filters: tableFilters,
              spatialFilters: shapes.map((s) => ({ id: s.id, wkt: s.wkt })),
              spatialTarget: target,
            }
          : {
              dashboardId,
              tableId,
              filters: tableFilters,
            };

        try {
          const result = await materializeFilter(args, controller.signal);
          useFilterViewStore
            .getState()
            .setView(tableId, result, dashboardId);
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          useFilterViewStore.getState().clearMaterializing(tableId);
          useToastStore
            .getState()
            .showToast((err as Error).message, "error");
        }
      }

      // PITFALL 2 cleanup: abort + prune controllers for tables no longer in mapOnlyTargets
      for (const [tid, ctrl] of controllersRef.current.entries()) {
        if (!activeTableIds.has(tid)) {
          ctrl.abort();
          controllersRef.current.delete(tid);
        }
      }
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId, spatialFilterVersion, mapOnlyTargets]);

  // --- 7. Unmount cleanup: abort all in-flight materializes ---
  useEffect(
    () => () => {
      controllersRef.current.forEach((c) => c.abort());
      controllersRef.current.clear();
    },
    [],
  );
}
