/**
 * UAT regression (v1.7 Phase 39/40 integration defect): cb_config + track_config
 * are TOP-LEVEL DashboardLayerDto columns, but CbConfigForm and track pickers write
 * them into the config blob (config.cb_config / config.track_config). LayersModal must
 * translate at the form↔onPatch seam:
 *   - MERGE top-level cb_config/track_config INTO the config the form reads
 *   - SPLIT them back OUT to top-level onPatch fields on change
 * Without this, wmsUrlBuilder (which reads layer.cb_config) never sees the operator's
 * classbreak config, so no CB or TRACK params appear in the WMS request.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DashboardLayerDto, TableDto } from "../api/client";

// Mock the form so we can (a) inspect the config it receives and (b) fire a
// synthetic onChange that buries cb_config/track_config in the config blob —
// exactly what the real CbConfigForm and track pickers do.
let lastFormConfig: Record<string, unknown> | null = null;
vi.mock("./charts/KineticaWmsLayerForm", () => ({
  default: (props: {
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
  }) => {
    lastFormConfig = props.config;
    return (
      <button
        data-testid="fire-cb-change"
        onClick={() =>
          props.onChange({
            ...props.config,
            renderMode: "classbreak",
            cb_config: JSON.stringify({
              attr: "passenger_count",
              valsType: "numeric",
              breaks: [{ value: 1, color: "FF1240" }],
            }),
            track_config: JSON.stringify({ enabled: true, headColor: "FFFF0000" }),
          })
        }
      >
        fire
      </button>
    );
  },
}));

import LayersModal from "./LayersModal";

const mkLayer = (
  id: number,
  overrides: Partial<DashboardLayerDto> = {},
): DashboardLayerDto => ({
  id,
  dashboard_id: 1,
  table_id: 10,
  layer_type: "KineticaWms",
  position: id,
  config: { renderMode: "classbreak", spatialMode: "latlon" },
  info_enabled: 1,
  info_columns: null,
  info_template: null,
  dynamic_view_id: null,
  cb_config: null,
  track_config: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  ...overrides,
});

const mkTable = (id: number, name: string): TableDto =>
  ({
    id,
    name,
    schema: "public",
    description: "",
    columns: { lat: "double", lon: "double" },
    created_at: "2026-05-05T00:00:00Z",
    updated_at: "2026-05-05T00:00:00Z",
  } as TableDto);

const baseProps = {
  layers: [] as DashboardLayerDto[],
  associatedTables: [mkTable(10, "orders")],
  onClose: () => {},
  onCreate: () => {},
  onDelete: () => {},
  onDuplicate: () => {},
  onPatch: () => {},
  onReorder: () => {},
};

describe("LayersModal cb_config/track_config seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastFormConfig = null;
  });

  it("merges persisted top-level cb_config + track_config INTO the config the form reads", () => {
    const persistedCb = JSON.stringify({
      attr: "fare_amount",
      valsType: "numeric",
      breaks: [{ value: 10, color: "FF0000FF" }],
    });
    const persistedTrack = JSON.stringify({ enabled: true, headColor: "FF00FF00" });
    render(
      <LayersModal
        {...baseProps}
        layers={[mkLayer(1, { cb_config: persistedCb, track_config: persistedTrack })]}
      />
    );
    expect(lastFormConfig).not.toBeNull();
    expect(lastFormConfig!.cb_config).toBe(persistedCb);
    expect(lastFormConfig!.track_config).toBe(persistedTrack);
  });

  it("splits cb_config + track_config OUT to top-level onPatch fields (not nested in config)", () => {
    const onPatch = vi.fn();
    render(<LayersModal {...baseProps} layers={[mkLayer(1)]} onPatch={onPatch} />);

    fireEvent.click(screen.getByTestId("fire-cb-change"));

    expect(onPatch).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onPatch.mock.calls[0];
    expect(layerId).toBe(1);
    // cb_config + track_config arrive as TOP-LEVEL patch fields
    expect(typeof patch.cb_config).toBe("string");
    expect(JSON.parse(patch.cb_config).attr).toBe("passenger_count");
    expect(typeof patch.track_config).toBe("string");
    expect(JSON.parse(patch.track_config).enabled).toBe(true);
    // and they are NOT buried inside the config blob
    expect(patch.config.cb_config).toBeUndefined();
    expect(patch.config.track_config).toBeUndefined();
    // renderMode (an actual config key) stays in the config blob
    expect(patch.config.renderMode).toBe("classbreak");
  });
});
