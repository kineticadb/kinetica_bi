/**
 * Phase 21 (POPUP-V14-02..05) / Phase 23 P01 — InfoPopup chrome-only spec.
 *
 * Reset shim from __mocks__/zustand.ts wipes the store between tests.
 *
 * Phase 23 P01 Task 2 split: body cases (H2/H3/H7, B1-B7, L1-L3, A1/A2, S1)
 * migrated to InfoSelectionView.spec.tsx as V1-V16. This file retains ONLY
 * popup-chrome cases:
 *   H1   activeLayerId null → renders nothing (chrome-render suppression)
 *   H4   close X click → onClose
 *   H5   ESC keydown → onClose
 *   H6   backdrop click → onClose; popup body click → no-op
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import InfoPopup from "./InfoPopup";
import { useInfoSelectionStore } from "../../store/infoSelectionStore";
import type { DashboardLayerDto } from "../../api/client";

function makeLayer(id: number, opts: Partial<DashboardLayerDto> = {}): DashboardLayerDto {
  return {
    id,
    dashboard_id: 1,
    table_id: 100 + id,
    layer_type: "KineticaWms",
    position: id,
    config: { spatialMode: "latlon", lonColumn: "lon", latColumn: "lat" },
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    dynamic_view_id: null,
    cb_config: null,
    track_config: null,
    created_at: "2026-05-08T00:00:00Z",
    updated_at: "2026-05-08T00:00:00Z",
    ...opts,
  };
}

const defaultProps = {
  eligibleLayers: [makeLayer(5), makeLayer(8)],
  layerNameFor: (l: DashboardLayerDto) => `Layer ${l.id}`,
  // Plan 23-03 Task 1: popup wrapper drops onLayerSwitch/onLoadMore (view owns those internally)
  // and now only passes resolveTable + onClose.
  resolveTable: (tableId: number) => ({ schema: "public", name: `t${tableId}` }),
  onClose: vi.fn(),
  // Popup-only sizing — caller (MapChartRenderer) supplies these from widget config.
  widthPx: 360,
  heightPx: 400,
  // Owning map widget.id — popup renders only when it owns the active selection.
  widgetId: 10,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InfoPopup", () => {
  // H1: activeLayerId=null → chrome wrapper renders nothing
  it("H1: renders nothing when activeLayerId is null", () => {
    const { container } = render(<InfoPopup {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  // H4: close X click → onClose
  it("H4: clicking close X calls onClose exactly once", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5, 10);  // owned by widgetId=10
    });
    render(<InfoPopup {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  // H5: ESC keydown → onClose
  it("H5: pressing Escape calls onClose exactly once", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5, 10);  // owned by widgetId=10
    });
    render(<InfoPopup {...defaultProps} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  // H7 (multi-map bug): a selection owned by ANOTHER map (activeWidgetId !== widgetId)
  // must render nothing here — clicking one map must not open/steal this map's popup.
  it("H7: renders nothing when the active selection is owned by another widget", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5, 99);  // owned by a DIFFERENT map
    });
    const { container } = render(<InfoPopup {...defaultProps} />);  // this popup is widgetId=10
    expect(container.firstChild).toBeNull();
    // ESC while a foreign map owns the selection must not dismiss via this popup.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  // H6: backdrop click → onClose; popup body click → no-op
  it("H6: clicking backdrop calls onClose; clicking popup body does not", () => {
    act(() => {
      useInfoSelectionStore.getState().setSelection(5, {
        rows: [{ a: 1 }],
        columns: ["a"],
        page: 0,
        hasMore: false,
      });
      useInfoSelectionStore.getState().setActiveLayer(5, 10);  // owned by widgetId=10
    });
    const { container } = render(<InfoPopup {...defaultProps} />);
    const backdrop = container.querySelector(".info-popup-backdrop")!;
    const popup = container.querySelector(".info-popup")!;
    // Click popup body → does NOT call onClose
    fireEvent.click(popup);
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    // Click backdrop → calls onClose
    fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
