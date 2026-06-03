import { describe, it, expect } from "vitest";
import {
  getSpatialTargets,
  isSpatialTargetEligible,
  aggregateSpatialTargetsByTable,
  type SpatialMode,
  type SpatialTarget,
} from "./spatialTargets";
import type { MapWidgetConfig } from "./wmsUrlBuilder";
import type { WidgetDto } from "../api/client";

describe("spatialTargets — Phase 28 (TARGET-V15-02)", () => {
  describe("SpatialMode + SpatialTarget types", () => {
    it("SpatialMode is the union 'latlon' | 'wkt' | 'wkb' (byte-parity with server)", () => {
      // Compile-time assertion via exhaustive switch
      const assertMode = (m: SpatialMode): string => {
        switch (m) {
          case "latlon":
            return "latlon";
          case "wkt":
            return "wkt";
          case "wkb":
            return "wkb";
        }
      };
      expect(assertMode("latlon")).toBe("latlon");
      expect(assertMode("wkt")).toBe("wkt");
      expect(assertMode("wkb")).toBe("wkb");
    });

    it("SpatialTarget shape matches server byte-for-byte (tableId + spatialMode required; lonCol/latCol/spatialCol optional)", () => {
      // Compile-time + runtime assertion: a minimum-viable SpatialTarget needs only tableId + spatialMode.
      const minimal: SpatialTarget = { tableId: 1, spatialMode: "latlon" };
      expect(minimal.tableId).toBe(1);
      expect(minimal.spatialMode).toBe("latlon");
      // All three column fields are optional and may coexist on the same value.
      const full: SpatialTarget = {
        tableId: 2,
        spatialMode: "wkt",
        lonCol: "x",
        latCol: "y",
        spatialCol: "geom",
      };
      expect(full.lonCol).toBe("x");
      expect(full.latCol).toBe("y");
      expect(full.spatialCol).toBe("geom");
    });
  });

  describe("getSpatialTargets", () => {
    it("returns [] for a legacy widget without spatialTargets (no migration needed)", () => {
      const legacy = { config: {} as Pick<MapWidgetConfig, "spatialTargets"> };
      expect(getSpatialTargets(legacy)).toEqual([]);
    });

    it("returns [] when config.spatialTargets === undefined (explicit undefined treated as missing)", () => {
      const widget = { config: { spatialTargets: undefined } as Pick<MapWidgetConfig, "spatialTargets"> };
      expect(getSpatialTargets(widget)).toEqual([]);
    });

    it("returns the same array reference when spatialTargets is set (no defensive copy — minimal-helper style)", () => {
      const targets: SpatialTarget[] = [
        { tableId: 1, spatialMode: "latlon", lonCol: "x", latCol: "y" },
        { tableId: 2, spatialMode: "wkt", spatialCol: "geom" },
      ];
      const widget = { config: { spatialTargets: targets } };
      const out = getSpatialTargets(widget);
      expect(out).toBe(targets); // reference equality, not just deep equality
      expect(out).toHaveLength(2);
    });

    it("returns [] for an empty stored array (still empty after default-coercion)", () => {
      const widget = { config: { spatialTargets: [] as SpatialTarget[] } };
      expect(getSpatialTargets(widget)).toEqual([]);
    });
  });

  describe("isSpatialTargetEligible", () => {
    it("returns false for spatialMode='wkb' even when spatialCol is set (TD-V14-WKB-SPIKE)", () => {
      expect(
        isSpatialTargetEligible({ tableId: 1, spatialMode: "wkb", spatialCol: "geom" }),
      ).toBe(false);
    });

    it("returns false for latlon target missing both lonCol and latCol", () => {
      expect(isSpatialTargetEligible({ tableId: 1, spatialMode: "latlon" })).toBe(false);
    });

    it("returns false for latlon target with lonCol but missing latCol", () => {
      expect(
        isSpatialTargetEligible({ tableId: 1, spatialMode: "latlon", lonCol: "x" }),
      ).toBe(false);
    });

    it("returns false for latlon target with latCol but missing lonCol", () => {
      expect(
        isSpatialTargetEligible({ tableId: 1, spatialMode: "latlon", latCol: "y" }),
      ).toBe(false);
    });

    it("returns true for latlon target with BOTH lonCol and latCol set", () => {
      expect(
        isSpatialTargetEligible({
          tableId: 1,
          spatialMode: "latlon",
          lonCol: "x",
          latCol: "y",
        }),
      ).toBe(true);
    });

    it("returns false for wkt target missing spatialCol", () => {
      expect(isSpatialTargetEligible({ tableId: 1, spatialMode: "wkt" })).toBe(false);
    });

    it("returns true for wkt target with spatialCol set", () => {
      expect(
        isSpatialTargetEligible({ tableId: 1, spatialMode: "wkt", spatialCol: "geom" }),
      ).toBe(true);
    });

    it("returns false for wkt target with empty-string spatialCol (falsy treated as missing)", () => {
      expect(
        isSpatialTargetEligible({ tableId: 1, spatialMode: "wkt", spatialCol: "" }),
      ).toBe(false);
    });

    it("returns false for latlon target with empty-string lonCol (falsy treated as missing)", () => {
      expect(
        isSpatialTargetEligible({
          tableId: 1,
          spatialMode: "latlon",
          lonCol: "",
          latCol: "y",
        }),
      ).toBe(false);
    });
  });
});

// ─── aggregateSpatialTargetsByTable — Phase 30 (MAT-V15-02 prerequisite) ────

const makeMapWidget = (
  id: number,
  spatialTargets: SpatialTarget[] = [],
  overrides: Partial<WidgetDto> = {},
): WidgetDto => ({
  id,
  dashboard_id: 1,
  title: `map-${id}`,
  type: "map",
  position: 0,
  config: { spatialTargets } as unknown as Record<string, unknown>,
  created_at: "2026-05-12T00:00:00Z",
  updated_at: "2026-05-12T00:00:00Z",
  ...overrides,
});

const makeNonMapWidget = (id: number, type: string): WidgetDto =>
  makeMapWidget(id, [], { type });

describe("aggregateSpatialTargetsByTable", () => {
  it("returns an empty Map for an empty widgets array", () => {
    expect(aggregateSpatialTargetsByTable([]).size).toBe(0);
  });

  it("returns an empty Map when no widgets are type 'map'", () => {
    const widgets = [makeNonMapWidget(1, "bar"), makeNonMapWidget(2, "pie")];
    expect(aggregateSpatialTargetsByTable(widgets).size).toBe(0);
  });

  it("returns one entry for one map widget with one eligible latlon target", () => {
    const target: SpatialTarget = { tableId: 5, spatialMode: "latlon", lonCol: "lon", latCol: "lat" };
    const widgets = [makeMapWidget(1, [target])];
    const result = aggregateSpatialTargetsByTable(widgets);
    expect(result.size).toBe(1);
    expect(result.get(5)).toEqual(target);
  });

  it("returns one entry per tableId for one map widget with multiple eligible targets on different tables", () => {
    const t1: SpatialTarget = { tableId: 5, spatialMode: "latlon", lonCol: "lon", latCol: "lat" };
    const t2: SpatialTarget = { tableId: 6, spatialMode: "wkt", spatialCol: "geom" };
    const widgets = [makeMapWidget(1, [t1, t2])];
    const result = aggregateSpatialTargetsByTable(widgets);
    expect(result.size).toBe(2);
    expect(result.has(5)).toBe(true);
    expect(result.has(6)).toBe(true);
  });

  it("widget-id-ascending tiebreaker: lower id wins when two map widgets target the same tableId", () => {
    const higherIdTarget: SpatialTarget = { tableId: 5, spatialMode: "latlon", lonCol: "a", latCol: "b" };
    const lowerIdTarget: SpatialTarget = { tableId: 5, spatialMode: "latlon", lonCol: "X", latCol: "Y" };
    // Note: widget id=2 is passed first in array, but id=1 should win
    const widgets = [makeMapWidget(2, [higherIdTarget]), makeMapWidget(1, [lowerIdTarget])];
    const result = aggregateSpatialTargetsByTable(widgets);
    expect(result.get(5)?.lonCol).toBe("X"); // from id=1 widget
  });

  it("sorts by id ascending regardless of input array order", () => {
    // Three widgets all targeting tableId=7 with distinct lonCol values
    const t10: SpatialTarget = { tableId: 7, spatialMode: "latlon", lonCol: "c10", latCol: "lat" };
    const t2: SpatialTarget = { tableId: 7, spatialMode: "latlon", lonCol: "c2", latCol: "lat" };
    const t5: SpatialTarget = { tableId: 7, spatialMode: "latlon", lonCol: "c5", latCol: "lat" };
    // Pass in order [id=10, id=2, id=5] — id=2's target should win
    const widgets = [makeMapWidget(10, [t10]), makeMapWidget(2, [t2]), makeMapWidget(5, [t5])];
    const result = aggregateSpatialTargetsByTable(widgets);
    expect(result.get(7)?.lonCol).toBe("c2"); // from id=2 widget (lowest)
  });

  it("skips WKB-mode targets — widget with only WKB target yields no entry for its tableId", () => {
    const wkbTarget: SpatialTarget = { tableId: 9, spatialMode: "wkb", spatialCol: "geom" };
    const widgets = [makeMapWidget(1, [wkbTarget])];
    const result = aggregateSpatialTargetsByTable(widgets);
    expect(result.size).toBe(0);
    expect(result.has(9)).toBe(false);
  });

  it("skips incomplete latlon targets (missing lonCol or latCol) and incomplete wkt targets (missing spatialCol)", () => {
    const incompleteLatlon: SpatialTarget = { tableId: 1, spatialMode: "latlon", lonCol: "x" }; // missing latCol
    const incompleteWkt: SpatialTarget = { tableId: 2, spatialMode: "wkt" }; // missing spatialCol
    const widgets = [makeMapWidget(1, [incompleteLatlon, incompleteWkt])];
    const result = aggregateSpatialTargetsByTable(widgets);
    expect(result.size).toBe(0);
  });

  it("ignores non-map widgets even when their config has spatialTargets-shaped fields", () => {
    const barWidget: WidgetDto = {
      ...makeNonMapWidget(1, "bar"),
      config: { spatialTargets: [{ tableId: 99, spatialMode: "latlon", lonCol: "x", latCol: "y" }] } as unknown as Record<string, unknown>,
    };
    const mapTarget: SpatialTarget = { tableId: 3, spatialMode: "latlon", lonCol: "x", latCol: "y" };
    const mapWidget = makeMapWidget(2, [mapTarget]);
    const result = aggregateSpatialTargetsByTable([barWidget, mapWidget]);
    expect(result.size).toBe(1);
    expect(result.has(3)).toBe(true);
    expect(result.has(99)).toBe(false);
  });
});
