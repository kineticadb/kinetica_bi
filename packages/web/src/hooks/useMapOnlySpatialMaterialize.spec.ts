/**
 * Phase 54 Plan 10 (TRACKFIX-V19-09 / GAP-54-10): specs for useMapOnlySpatialMaterialize.
 *
 * Covers 9 locked behaviors:
 *   T1  Map-only table fires materializeFilter exactly once on draw
 *   T2  Sole-trigger preserved: map + bar on T → hook does NOT fire for T
 *   T3  Records also counts as trigger: map + records on T → hook does NOT fire for T
 *   T4  No shapes → no fire; if stale view exists, drop it
 *   T5  No eligible target → no fire (wkb / missing cols)
 *   T6  Column filters composed with spatial filters in args
 *   T7  Per-table AbortController: rapid version bumps abort prior in-flight for same table
 *   T8  Clear shapes drops view (dropFilterView + clearView)
 *   T9  Multi map-only tables: both T1 and T2 fire once each
 *
 * Timer strategy: real timers with waitFor (mirroring useDynamicViewMaterializeChain.spec.ts).
 * The 300ms debounce means tests are naturally slightly slower; waitFor default 1s is sufficient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";

import { useMapOnlySpatialMaterialize } from "./useMapOnlySpatialMaterialize";
import { useSpatialFilterStore } from "../store/spatialFilterStore";
import { useFilterStore } from "../store/filterStore";
import { useFilterViewStore } from "../store/filterViewStore";
import type { WidgetDto } from "../api/client";
import type { ActiveFilter } from "../store/filterStore";

// ---------------------------------------------------------------------------
// Mock the client module
// ---------------------------------------------------------------------------
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    materializeFilter: vi.fn(),
    dropFilterView: vi.fn(),
  };
});

import { materializeFilter, dropFilterView } from "../api/client";

// ---------------------------------------------------------------------------
// Widget factories
// ---------------------------------------------------------------------------

/** Build a map widget with an eligible latlon spatial target for the given tableId. */
const makeMapWidget = (id: number, tableId: number): WidgetDto => ({
  id,
  dashboard_id: 42,
  type: "map",
  title: `Map ${id}`,
  position: id,
  config: {
    spatialTargets: [
      { tableId, spatialMode: "latlon", lonCol: "x", latCol: "y" },
    ],
  },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

/** Build a map widget with an INeligible WKB target for the given tableId. */
const makeMapWidgetWkb = (id: number, tableId: number): WidgetDto => ({
  id,
  dashboard_id: 42,
  type: "map",
  title: `Map ${id}`,
  position: id,
  config: {
    spatialTargets: [{ tableId, spatialMode: "wkb" }],
  },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

/** Build a trigger widget (bar/records/pie/scatter/line) for the given tableId. */
const makeTriggerWidget = (
  id: number,
  tableId: number,
  type: "bar" | "records" | "pie" | "scatter" | "line",
): WidgetDto => ({
  id,
  dashboard_id: 42,
  type,
  title: `Chart ${id}`,
  position: id,
  config: { tableId },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

const addShape = () =>
  useSpatialFilterStore.getState().addShape({
    type: "bbox",
    wkt: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
    measurement: "1km × 1km",
  });

const clearAllShapes = () => useSpatialFilterStore.getState().clearAll();

// Wait enough for the 300ms debounce to fire + microtasks to flush
const waitForDebounce = () =>
  new Promise<void>((r) => setTimeout(r, 350));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useMapOnlySpatialMaterialize (Phase 54 TRACKFIX-V19-09)", () => {
  beforeEach(() => {
    (materializeFilter as Mock).mockReset();
    (dropFilterView as Mock).mockReset();
    (materializeFilter as Mock).mockResolvedValue({
      viewName: "_kbi_filt_x",
      expiresAt: 9_999_999_999,
    });
    (dropFilterView as Mock).mockResolvedValue({ dropped: true });
  });

  // T1 ---------------------------------------------------------------------
  it(
    "T1 map-only table fires materializeFilter exactly once on draw",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [makeMapWidget(1, tableId)];

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      act(() => { addShape(); });

      await waitForDebounce();

      await waitFor(() => {
        expect(materializeFilter).toHaveBeenCalledTimes(1);
      });

      const args = (materializeFilter as Mock).mock.calls[0][0];
      expect(args.dashboardId).toBe(42);
      expect(args.tableId).toBe(tableId);
      expect(args.filters).toEqual([]);
      expect(args.spatialFilters).toHaveLength(1);
      expect(args.spatialFilters[0].wkt).toBe("POLYGON((0 0,1 0,1 1,0 1,0 0))");
      expect(args.spatialTarget).toMatchObject({
        tableId,
        spatialMode: "latlon",
        lonCol: "x",
        latCol: "y",
      });

      // setView called → view entry exists
      await waitFor(() => {
        expect(useFilterViewStore.getState().views[tableId]).toBeDefined();
      });
    },
    10000,
  );

  // T2 ---------------------------------------------------------------------
  it(
    "T2 sole-trigger preserved: map + bar on T → hook does NOT fire materializeFilter",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [
        makeMapWidget(1, tableId),
        makeTriggerWidget(2, tableId, "bar"),
      ];

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      act(() => { addShape(); });

      await waitForDebounce();
      await new Promise((r) => setTimeout(r, 50));

      expect(materializeFilter).not.toHaveBeenCalled();
    },
    10000,
  );

  // T3 ---------------------------------------------------------------------
  it(
    "T3 records also counts as trigger: map + records on T → hook does NOT fire for T",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [
        makeMapWidget(1, tableId),
        makeTriggerWidget(2, tableId, "records"),
      ];

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      act(() => { addShape(); });

      await waitForDebounce();
      await new Promise((r) => setTimeout(r, 50));

      expect(materializeFilter).not.toHaveBeenCalled();
    },
    10000,
  );

  // T4 ---------------------------------------------------------------------
  it(
    "T4 no shapes → no fire; if stale view exists, drop it",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [makeMapWidget(1, tableId)];

      // Pre-populate a stale view entry
      act(() => {
        useFilterViewStore.getState().setView(
          tableId,
          { viewName: "_kbi_filt_stale", expiresAt: 9_999_999_999 },
          42,
        );
      });

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      // No shapes — the hook fires on mount (spatialFilterVersion === 0, no shapes)
      await waitForDebounce();

      // No materializeFilter call (no shapes, no column filters)
      expect(materializeFilter).not.toHaveBeenCalled();

      // dropFilterView should be called (stale view dropped)
      await waitFor(() => {
        expect(dropFilterView).toHaveBeenCalledTimes(1);
      });
      const dropArgs = (dropFilterView as Mock).mock.calls[0][0];
      expect(dropArgs.dashboardId).toBe(42);
      expect(dropArgs.tableId).toBe(tableId);

      // clearView removes the entry
      await waitFor(() => {
        expect(useFilterViewStore.getState().views[tableId]).toBeUndefined();
      });
    },
    10000,
  );

  // T5 ---------------------------------------------------------------------
  it(
    "T5 no eligible target (wkb) → no fire",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [makeMapWidgetWkb(1, tableId)];

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      act(() => { addShape(); });

      await waitForDebounce();
      await new Promise((r) => setTimeout(r, 50));

      expect(materializeFilter).not.toHaveBeenCalled();
    },
    10000,
  );

  // T6 ---------------------------------------------------------------------
  it(
    "T6 column filters composed: filters[T] populated → materializeFilter args.filters contains them",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [makeMapWidget(1, tableId)];

      const columnFilter: ActiveFilter = {
        column: "speed",
        value: 100,
        dataType: "number",
        operator: "eq",
        addedAt: Date.now(),
      };

      act(() => {
        useFilterStore.getState().addFilter(tableId, columnFilter);
      });

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      act(() => { addShape(); });

      await waitForDebounce();

      await waitFor(() => {
        expect(materializeFilter).toHaveBeenCalledTimes(1);
      });

      const args = (materializeFilter as Mock).mock.calls[0][0];
      expect(args.filters).toHaveLength(1);
      expect(args.filters[0].column).toBe("speed");
      expect(args.spatialFilters).toHaveLength(1);
    },
    10000,
  );

  // T7 ---------------------------------------------------------------------
  it(
    "T7 rapid spatialFilterVersion bumps abort the prior in-flight for same table",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [makeMapWidget(1, tableId)];

      // First call hangs (never resolves until we call resolveFirst)
      let resolveFirst: (() => void) | undefined;
      const firstPromise = new Promise<{ viewName: string; expiresAt: number }>(
        (res) => {
          resolveFirst = () =>
            res({ viewName: "_kbi_filt_x", expiresAt: 9_999_999_999 });
        },
      );
      (materializeFilter as Mock).mockReturnValueOnce(firstPromise);
      (materializeFilter as Mock).mockResolvedValue({
        viewName: "_kbi_filt_y",
        expiresAt: 9_999_999_999,
      });

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      // First shape draw
      act(() => { addShape(); });

      await waitForDebounce();
      await waitFor(() => expect(materializeFilter).toHaveBeenCalledTimes(1));
      const firstSignal = (materializeFilter as Mock).mock.calls[0][1] as AbortSignal;
      expect(firstSignal.aborted).toBe(false);

      // Second shape draw — should abort the prior in-flight
      act(() => { addShape(); });

      await waitForDebounce();
      await waitFor(() => expect(materializeFilter).toHaveBeenCalledTimes(2));
      const secondSignal = (materializeFilter as Mock).mock.calls[1][1] as AbortSignal;

      expect(firstSignal.aborted).toBe(true);
      expect(secondSignal.aborted).toBe(false);
      expect(secondSignal).not.toBe(firstSignal);

      resolveFirst?.();
    },
    15000,
  );

  // T8 ---------------------------------------------------------------------
  it(
    "T8 clear shapes drops the view (dropFilterView + clearView)",
    async () => {
      const tableId = 10;
      const widgets: WidgetDto[] = [makeMapWidget(1, tableId)];

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      // First: draw a shape → materialize
      act(() => { addShape(); });
      await waitForDebounce();

      await waitFor(() => {
        expect(materializeFilter).toHaveBeenCalledTimes(1);
        expect(useFilterViewStore.getState().views[tableId]).toBeDefined();
      });

      // Clear shapes → effect fires again with zero shapes → drop
      act(() => { clearAllShapes(); });
      await waitForDebounce();

      await waitFor(() => {
        expect(dropFilterView).toHaveBeenCalledTimes(1);
      });
      const dropArgs = (dropFilterView as Mock).mock.calls[0][0];
      expect(dropArgs.tableId).toBe(tableId);
      expect(dropArgs.dashboardId).toBe(42);

      await waitFor(() => {
        expect(useFilterViewStore.getState().views[tableId]).toBeUndefined();
      });
    },
    15000,
  );

  // T9 ---------------------------------------------------------------------
  it(
    "T9 multi map-only tables: materialize fires for BOTH T1 and T2 exactly once each",
    async () => {
      const tableId1 = 10;
      const tableId2 = 20;
      const widgets: WidgetDto[] = [
        makeMapWidget(1, tableId1),
        makeMapWidget(2, tableId2),
      ];

      renderHook(() => useMapOnlySpatialMaterialize(42, widgets));

      act(() => { addShape(); });
      await waitForDebounce();

      await waitFor(() => {
        expect(materializeFilter).toHaveBeenCalledTimes(2);
      });

      const calledTableIds = (materializeFilter as Mock).mock.calls
        .map((c) => (c[0] as { tableId: number }).tableId)
        .sort((a, b) => a - b);
      expect(calledTableIds).toEqual([tableId1, tableId2]);
    },
    10000,
  );
});
