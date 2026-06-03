import { describe, it, expect } from "vitest";
import { hasValidSource, isLayerEffectivelyVisible } from "./layerVisibility";
import type { DashboardLayerDto, DynamicViewRow, TableDto } from "../api/client";

const mkTable = (over: Partial<TableDto> = {}): TableDto =>
  ({
    id: 10,
    schema: "ki_home",
    name: "events",
    columns: {},
    ...over,
  }) as TableDto;

const mkDv = (over: Partial<DynamicViewRow> = {}): DynamicViewRow =>
  ({
    id: 7,
    dashboard_id: 1,
    source_table_id: 10,
    name: "top_vendors",
    template_sql: "SELECT * FROM {view}",
    max_records: 10000,
    columns_json: null,
    created_at: "x",
    updated_at: "x",
    ...over,
  }) as DynamicViewRow;

const mkLayer = (over: Partial<DashboardLayerDto> = {}): DashboardLayerDto =>
  ({
    id: 1,
    dashboard_id: 1,
    table_id: 10,
    dynamic_view_id: null,
    position: 0,
    config: { visible: true },
    info_enabled: 1,
    info_columns: null,
    info_template: null,
    ...over,
  }) as DashboardLayerDto;

describe("hasValidSource", () => {
  describe("table-bound layers", () => {
    it("returns true when the layer's table_id resolves to a table with non-empty name", () => {
      expect(hasValidSource(mkLayer(), [mkTable()], [])).toBe(true);
    });

    it("returns false when the layer's table_id has no matching row (orphan)", () => {
      expect(hasValidSource(mkLayer({ table_id: 99 }), [mkTable()], [])).toBe(false);
    });

    it("returns false when the matching table has empty name", () => {
      expect(
        hasValidSource(mkLayer(), [mkTable({ name: "" })], []),
      ).toBe(false);
    });

    it("returns true when schema is empty but name is non-empty (bare table)", () => {
      expect(
        hasValidSource(mkLayer(), [mkTable({ schema: "" })], []),
      ).toBe(true);
    });

    it("returns false when there are no tables in the list", () => {
      expect(hasValidSource(mkLayer(), [], [])).toBe(false);
    });
  });

  describe("dv-bound layers", () => {
    it("returns true when the layer's dynamic_view_id resolves to a dv row with non-empty name", () => {
      expect(
        hasValidSource(
          mkLayer({ dynamic_view_id: 7 }),
          [mkTable()],
          [mkDv()],
        ),
      ).toBe(true);
    });

    it("returns false when the layer's dynamic_view_id has no matching row (orphan)", () => {
      expect(
        hasValidSource(
          mkLayer({ dynamic_view_id: 99 }),
          [mkTable()],
          [mkDv()],
        ),
      ).toBe(false);
    });

    it("returns false when the matching dv has empty name", () => {
      expect(
        hasValidSource(
          mkLayer({ dynamic_view_id: 7 }),
          [mkTable()],
          [mkDv({ name: "" })],
        ),
      ).toBe(false);
    });

    it("returns false when there are no dvs in the list", () => {
      expect(
        hasValidSource(mkLayer({ dynamic_view_id: 7 }), [mkTable()], []),
      ).toBe(false);
    });

    it("dv-bound layer is independent of table_id — table missing is OK as long as dv is valid", () => {
      // table_id stays = dv.source_table_id by design, but if upstream table is
      // deleted, the dv still references it. The layer's source identity comes
      // from the dv, not the source table.
      expect(
        hasValidSource(
          mkLayer({ dynamic_view_id: 7, table_id: 999 }),
          [],
          [mkDv()],
        ),
      ).toBe(true);
    });
  });
});

describe("isLayerEffectivelyVisible", () => {
  it("returns false when operator preference is hidden, even with valid source", () => {
    const layer = mkLayer({ config: { visible: false } });
    expect(isLayerEffectivelyVisible(layer, [mkTable()], [])).toBe(false);
  });

  it("returns false when operator preference is visible but source is invalid", () => {
    const layer = mkLayer({ config: { visible: true }, table_id: 999 });
    expect(isLayerEffectivelyVisible(layer, [mkTable()], [])).toBe(false);
  });

  it("returns true when operator preference is visible AND source is valid", () => {
    expect(isLayerEffectivelyVisible(mkLayer(), [mkTable()], [])).toBe(true);
  });

  it("treats missing config.visible as visible (lazy default)", () => {
    const layer = mkLayer({ config: {} });
    expect(isLayerEffectivelyVisible(layer, [mkTable()], [])).toBe(true);
  });

  it("dv-bound + orphan dv → effectively hidden regardless of operator preference", () => {
    const layer = mkLayer({
      dynamic_view_id: 7,
      config: { visible: true },
    });
    // dv list is EMPTY — orphan binding
    expect(isLayerEffectivelyVisible(layer, [mkTable()], [])).toBe(false);
  });

  it("dv-bound + dv with empty name → effectively hidden", () => {
    const layer = mkLayer({ dynamic_view_id: 7 });
    expect(
      isLayerEffectivelyVisible(layer, [mkTable()], [mkDv({ name: "" })]),
    ).toBe(false);
  });
});
