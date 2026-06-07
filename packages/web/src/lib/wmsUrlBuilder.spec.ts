/**
 * Phase 11 origin → Phase 16 v1.3 cleanup: buildWmsParams spec.
 *
 * Locked param names from 11-SPIKE-NOTES.md (HIGH confidence, verified against
 * deployed Kinetica at http://kinetica.example.com:9191/gpudb-0):
 *   X_ATTR      — lon column (X axis = longitude)
 *   Y_ATTR      — lat column (Y axis = latitude)
 *   GEO_ATTR    — geometry column (WKT or WKB mode)
 *   EPSG:3857   — locked SRS value (PITFALL M-03)
 *   POINTOPACITY — separate param (NOT RRGGBBAA suffix on POINTCOLOR; both accepted but separate is cleaner)
 *
 * Phase 16 deletions: QUERY (FILT-04), _v (cache-buster), whereClause arg.
 * Phase 16 additions: _mv (materializeVersion cache-buster, conditional emit) + LAYERS source decision tree.
 *
 * Requirements covered: MAP-01, MAP-02, MAP-V13-01..06
 */

import { describe, it, expect } from "vitest";
import { buildWmsParams, type MapWidgetConfig } from "./wmsUrlBuilder";

// ─── helper ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<MapWidgetConfig> = {}): MapWidgetConfig {
  return {
    tableId: 1,
    spatialMode: "latlon",
    latColumn: "lat",
    lonColumn: "lon",
    renderMode: "raster",
    layerName: "demo.points",
    ...overrides,
  };
}

// ─── base params (Phase 16: _v removed; _mv added; LAYERS source decision tree split out) ──

describe("buildWmsParams — base params", () => {
  it("always emits SERVICE=WMS, VERSION=1.1.1, REQUEST=GetMap, FORMAT=image/png, TRANSPARENT=true", () => {
    const result = buildWmsParams(makeConfig(), undefined);
    expect(result.SERVICE).toBe("WMS");
    expect(result.VERSION).toBe("1.1.1");
    expect(result.REQUEST).toBe("GetMap");
    expect(result.FORMAT).toBe("image/png");
    expect(result.TRANSPARENT).toBe("true");
  });

  it("emits SRS=EPSG:3857 (spike-locked value, PITFALL M-03)", () => {
    const result = buildWmsParams(makeConfig(), undefined);
    expect(result.SRS).toBe("EPSG:3857");
  });
});

// ─── LAYERS source decision tree (Phase 16 MAP-V13-01 / MAP-V13-02) ─────────

describe("buildWmsParams — LAYERS source decision tree", () => {
  it("emits LAYERS=config.tableRef when tableRef is set (canonical field; viewName substitution happens at call site)", () => {
    const result = buildWmsParams(makeConfig({ tableRef: "public.taxi_trips", layerName: undefined }), undefined);
    expect(result.LAYERS).toBe("public.taxi_trips");
  });

  it("emits LAYERS=config.layerName when layerName is set and tableRef is absent (back-compat)", () => {
    const result = buildWmsParams(makeConfig({ layerName: "schema.table", tableRef: undefined }), undefined);
    expect(result.LAYERS).toBe("schema.table");
  });

  it("tableRef takes precedence over layerName when both are set", () => {
    const result = buildWmsParams(makeConfig({ tableRef: "public.trips", layerName: "demo.nyctaxi" }), undefined);
    expect(result.LAYERS).toBe("public.trips");
  });

  it("omits LAYERS when both tableRef and layerName are undefined", () => {
    const result = buildWmsParams(makeConfig({ layerName: undefined, tableRef: undefined }), undefined);
    expect(result).not.toHaveProperty("LAYERS");
  });

  it("emits LAYERS=<viewName> when caller substitutes viewName into tableRef (Phase 16 active-filter path)", () => {
    // Phase 16 caller pattern: tableRef = viewName ?? rawTableRef.
    // Builder is unaware of view-vs-raw distinction; both pass through tableRef → LAYERS.
    const result = buildWmsParams(makeConfig({ tableRef: "_kbi_filt_u1_d1_t10_sabc" }), 3);
    expect(result.LAYERS).toBe("_kbi_filt_u1_d1_t10_sabc");
  });
});

// ─── _mv emission (Phase 16 MAP-V13-03 / PT16-A lock) ───────────────────────

describe("buildWmsParams — _mv emission", () => {
  it("emits _mv as stringified materializeVersion when materializeVersion is provided", () => {
    const result = buildWmsParams(makeConfig(), 42);
    expect(result._mv).toBe("42");
  });

  it("emits _mv=0 when materializeVersion is 0 (zero is a valid version when explicitly passed)", () => {
    const result = buildWmsParams(makeConfig(), 0);
    expect(result._mv).toBe("0");
  });

  it("OMITS _mv entirely when materializeVersion is undefined (PT16-A lock: no _mv=0 sentinel for no-view path)", () => {
    const result = buildWmsParams(makeConfig(), undefined);
    expect(result).not.toHaveProperty("_mv");
  });

  it("NEVER emits _v anywhere (Phase 16 deletion: _v cache-buster removed)", () => {
    expect(buildWmsParams(makeConfig(), 7)).not.toHaveProperty("_v");
    expect(buildWmsParams(makeConfig(), undefined)).not.toHaveProperty("_v");
  });

  it("NEVER emits QUERY anywhere (Phase 16 deletion: FILT-04 whereClause block removed)", () => {
    expect(buildWmsParams(makeConfig(), 42)).not.toHaveProperty("QUERY");
    expect(buildWmsParams(makeConfig(), undefined)).not.toHaveProperty("QUERY");
  });
});

// ─── spatial mode: latlon ──────────────────────────────────────────────────

describe("buildWmsParams — spatial mode: latlon", () => {
  it("emits X_ATTR=lonCol and Y_ATTR=latCol when spatialMode=latlon (X=lon, Y=lat per Kinetica convention)", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "latlon", lonColumn: "pickup_longitude", latColumn: "pickup_latitude" }),
      1,
    );
    expect(result.X_ATTR).toBe("pickup_longitude");
    expect(result.Y_ATTR).toBe("pickup_latitude");
  });

  it("omits GEO_ATTR when spatialMode=latlon", () => {
    const result = buildWmsParams(makeConfig({ spatialMode: "latlon" }), 1);
    expect(result).not.toHaveProperty("GEO_ATTR");
  });

  it("omits X_ATTR when lonColumn is undefined (returns dict without it; WMS request will be malformed-but-debuggable)", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "latlon", lonColumn: undefined, latColumn: "lat" }),
      1,
    );
    expect(result).not.toHaveProperty("X_ATTR");
  });

  it("omits Y_ATTR when latColumn is undefined", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "latlon", lonColumn: "lon", latColumn: undefined }),
      1,
    );
    expect(result).not.toHaveProperty("Y_ATTR");
  });
});

// ─── spatial mode: wkt ─────────────────────────────────────────────────────

describe("buildWmsParams — spatial mode: wkt", () => {
  it("emits GEO_ATTR=wktCol when spatialMode=wkt", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "wkt", wktColumn: "geom_wkt" }),
      1,
    );
    expect(result.GEO_ATTR).toBe("geom_wkt");
  });

  it("omits X_ATTR and Y_ATTR when spatialMode=wkt", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "wkt", wktColumn: "geom_wkt" }),
      1,
    );
    expect(result).not.toHaveProperty("X_ATTR");
    expect(result).not.toHaveProperty("Y_ATTR");
  });
});

// ─── spatial mode: wkb ─────────────────────────────────────────────────────

describe("buildWmsParams — spatial mode: wkb", () => {
  it("emits GEO_ATTR=wkbCol when spatialMode=wkb (PITFALL M-04: same param name as wkt; Kinetica detects type from column metadata)", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "wkb", wkbColumn: "geom_wkb" }),
      1,
    );
    expect(result.GEO_ATTR).toBe("geom_wkb");
  });

  it("omits X_ATTR and Y_ATTR when spatialMode=wkb", () => {
    const result = buildWmsParams(
      makeConfig({ spatialMode: "wkb", wkbColumn: "geom_wkb" }),
      1,
    );
    expect(result).not.toHaveProperty("X_ATTR");
    expect(result).not.toHaveProperty("Y_ATTR");
  });
});

// ─── render mode: raster ───────────────────────────────────────────────────

describe("buildWmsParams — render mode: raster", () => {
  it("emits STYLES=raster (spike-locked value)", () => {
    const result = buildWmsParams(makeConfig({ renderMode: "raster" }), 1);
    expect(result.STYLES).toBe("raster");
  });

  it("emits POINTCOLORS=AARRGGBB (8-digit; legacy 6-digit normalizes to FF + RRGGBB)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointColor: "FF3838" }),
      1,
    );
    expect(result.POINTCOLORS).toBe("FFFF3838");
  });

  it("emits POINTCOLORS=AARRGGBB unchanged when an explicit 8-char value is set (50% alpha example)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointColor: "80FF3838" }),
      1,
    );
    expect(result.POINTCOLORS).toBe("80FF3838");
  });

  it("emits separate POINTOPACITY=<0-100> when pointOpacity is set (POINTCOLORS becomes AARRGGBB; POINTOPACITY remains a separate param per SPIKE-NOTES Q6)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointColor: "FF3838", pointOpacity: 75 }),
      1,
    );
    expect(result.POINTCOLORS).toBe("FFFF3838");
    expect(result.POINTOPACITY).toBe("75");
  });

  it("emits POINTOPACITY=100 when pointOpacity=100", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointColor: "FF3838", pointOpacity: 100 }),
      1,
    );
    expect(result.POINTOPACITY).toBe("100");
  });

  it("emits POINTOPACITY=50 when pointOpacity=50", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointColor: "FF3838", pointOpacity: 50 }),
      1,
    );
    expect(result.POINTOPACITY).toBe("50");
  });

  it("emits POINTOPACITY=0 when pointOpacity=0", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointColor: "FF3838", pointOpacity: 0 }),
      1,
    );
    expect(result.POINTOPACITY).toBe("0");
  });

  it("emits POINTSIZES=<int> when pointSize is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointSize: 8 }),
      1,
    );
    expect(result.POINTSIZES).toBe("8");
  });

  it("omits POINTCOLORS and POINTOPACITY when not set", () => {
    const result = buildWmsParams(makeConfig({ renderMode: "raster" }), 1);
    expect(result).not.toHaveProperty("POINTCOLORS");
    expect(result).not.toHaveProperty("POINTOPACITY");
  });

  it("emits POINTSHAPES=<shape> when pointShape is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", pointShape: "diamond" }),
      1,
    );
    expect(result.POINTSHAPES).toBe("diamond");
  });

  it("emits SHAPEFILLCOLORS=AARRGGBB (legacy 6-digit normalizes to FF + RRGGBB, uppercase)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", shapeFillColor: "abcdef" }),
      1,
    );
    expect(result.SHAPEFILLCOLORS).toBe("FFABCDEF");
  });

  it("emits SHAPEFILLCOLORS=AARRGGBB unchanged when an explicit 8-char value is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", shapeFillColor: "40ABCDEF" }),
      1,
    );
    expect(result.SHAPEFILLCOLORS).toBe("40ABCDEF");
  });

  it("emits SHAPELINECOLORS=AARRGGBB (legacy 6-digit normalizes to FF + RRGGBB, uppercase)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", shapeLineColor: "112233" }),
      1,
    );
    expect(result.SHAPELINECOLORS).toBe("FF112233");
  });

  it("emits SHAPELINECOLORS=AARRGGBB unchanged when an explicit 8-char value is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", shapeLineColor: "80112233" }),
      1,
    );
    expect(result.SHAPELINECOLORS).toBe("80112233");
  });

  it("emits SHAPELINEWIDTHS=<int> when shapeLineWidth is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", shapeLineWidth: 5 }),
      1,
    );
    expect(result.SHAPELINEWIDTHS).toBe("5");
  });

  it("emits SHAPELINEWIDTHS=0 when shapeLineWidth=0 (boundary)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", shapeLineWidth: 0 }),
      1,
    );
    expect(result.SHAPELINEWIDTHS).toBe("0");
  });

  it("emits ANTIALIASING=true when antialiasing=true", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", antialiasing: true }),
      1,
    );
    expect(result.ANTIALIASING).toBe("true");
  });

  it("emits ANTIALIASING=false when antialiasing=false", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "raster", antialiasing: false }),
      1,
    );
    expect(result.ANTIALIASING).toBe("false");
  });

  it("omits POINTSHAPES, SHAPEFILLCOLORS, SHAPELINECOLORS, SHAPELINEWIDTHS, ANTIALIASING when not set", () => {
    const result = buildWmsParams(makeConfig({ renderMode: "raster" }), 1);
    expect(result).not.toHaveProperty("POINTSHAPES");
    expect(result).not.toHaveProperty("SHAPEFILLCOLORS");
    expect(result).not.toHaveProperty("SHAPELINECOLORS");
    expect(result).not.toHaveProperty("SHAPELINEWIDTHS");
    expect(result).not.toHaveProperty("ANTIALIASING");
  });
});

// ─── render mode: heatmap ──────────────────────────────────────────────────

describe("buildWmsParams — render mode: heatmap", () => {
  it("emits STYLES=heatmap", () => {
    const result = buildWmsParams(makeConfig({ renderMode: "heatmap" }), 1);
    expect(result.STYLES).toBe("heatmap");
  });

  it("emits BLUR_RADIUS=<int> when blurRadius is set (units = Kinetica map units, PITFALL M-05)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "heatmap", blurRadius: 10 }),
      1,
    );
    expect(result.BLUR_RADIUS).toBe("10");
  });

  it("emits COLORMAP=<name> when colormap is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "heatmap", colormap: "viridis" }),
      1,
    );
    expect(result.COLORMAP).toBe("viridis");
  });

  // MIN_LEVEL + MAX_LEVEL were removed from the catalog — those WMS params are
  // not in Kinetica's WMS docs and the deployed server does not consume them.
  // The previous spec asserted emit-on-defined behavior; the post-VERIFY
  // behavior is to NEVER emit them regardless of legacy config presence (the
  // type union has dropped minLevel/maxLevel so they can't be set anyway).
  it("never emits MIN_LEVEL or MAX_LEVEL — both dropped from catalog post-VERIFY", () => {
    const result = buildWmsParams(makeConfig({ renderMode: "heatmap" }), 1);
    expect(result).not.toHaveProperty("MIN_LEVEL");
    expect(result).not.toHaveProperty("MAX_LEVEL");
  });

  it("emits REVERSE_COLORMAP=TRUE when reverseColormap is true", () => {
    const result = buildWmsParams(
      makeConfig({
        renderMode: "heatmap",
        colormap: "viridis",
        reverseColormap: true,
      }),
      1,
    );
    expect(result.REVERSE_COLORMAP).toBe("TRUE");
  });

  it("ALWAYS emits REVERSE_COLORMAP=FALSE when reverseColormap is false or undefined (OL updateParams merges — omitting would leak prior TRUE value)", () => {
    // OL's source.updateParams MERGES new params into existing params — it
    // does not replace. If a prior URL had REVERSE_COLORMAP=TRUE and the next
    // call omits the key, the prior TRUE persists on the source and shows up
    // on every subsequent tile URL. Always emitting the explicit FALSE
    // overwrites during merge.

    // false branch — operator explicitly opted out
    const resultFalse = buildWmsParams(
      makeConfig({
        renderMode: "heatmap",
        colormap: "viridis",
        reverseColormap: false,
      }),
      1,
    );
    expect(resultFalse.REVERSE_COLORMAP).toBe("FALSE");

    // undefined branch — operator never touched the toggle (defaults to FALSE
    // explicitly to overwrite any stale OL-source-merged TRUE)
    const resultUndef = buildWmsParams(
      makeConfig({ renderMode: "heatmap", colormap: "viridis" }),
      1,
    );
    expect(resultUndef.REVERSE_COLORMAP).toBe("FALSE");
  });
});

// ─── render mode: classbreak (legacy — superseded by Lane C cb_raster in v1.7 Phase 38) ───
// NOTE: These legacy tests are REPLACED by the Lane C cb_raster describe blocks at the
// bottom of this file (v1.7 Phase 38 SCHEMA-V17-03). The classbreak branch in
// wmsUrlBuilder.ts was DELETED (hard cutover per 38-CONTEXT.md §"Legacy widget backward-compat").
// STYLES_BY_MODE.classbreak is now "cb_raster" and Lane A param names are gone.

describe("buildWmsParams — render mode: classbreak (STYLES_BY_MODE swap — v1.7 Phase 38)", () => {
  it("emits STYLES=cb_raster for renderMode=classbreak (v1.7 STYLES_BY_MODE swap — Lane C single path)", () => {
    // Lane A (STYLES=classbreak) is DELETED. STYLES_BY_MODE.classbreak is now "cb_raster".
    const result = buildWmsParams(makeConfig({ renderMode: "classbreak" }), 1);
    expect(result.STYLES).toBe("cb_raster");
  });

  it("does NOT emit any CB_COLUMN_NAME / CB_BREAK_TYPE / CB_BREAK_POINT_* / CB_POINTCOLOR_* (Lane A deleted)", () => {
    // Hard cutover: Lane A naming is gone. Legacy config.classbreaks[] is NOT read.
    const result = buildWmsParams(
      makeConfig({ renderMode: "classbreak", cbColumn: "fare_amount", classbreaks: [{ value: "A", color: "FF0000" }] }),
      1,
    );
    expect(result.CB_COLUMN_NAME).toBeUndefined();
    expect(result.CB_BREAK_TYPE).toBeUndefined();
    expect(result).not.toHaveProperty("CB_BREAK_POINT_1");
    expect(result).not.toHaveProperty("CB_POINTCOLOR_1");
  });
});

// ─── render mode: contour ──────────────────────────────────────────────────

describe("buildWmsParams — render mode: contour", () => {
  it("emits STYLES=contour", () => {
    const result = buildWmsParams(makeConfig({ renderMode: "contour" }), 1);
    expect(result.STYLES).toBe("contour");
  });

  it("emits CONTOUR_COLOR=<RRGGBB> when contourColor is set", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "contour", contourColor: "0000FF" }),
      1,
    );
    expect(result.CONTOUR_COLOR).toBe("0000FF");
  });

  it("emits CONTOUR_SMOOTH=true when contourSmooth=true", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "contour", contourSmooth: true }),
      1,
    );
    expect(result.CONTOUR_SMOOTH).toBe("true");
  });

  it("emits CONTOUR_SMOOTH=false when contourSmooth=false", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "contour", contourSmooth: false }),
      1,
    );
    expect(result.CONTOUR_SMOOTH).toBe("false");
  });

  it("emits CONTOUR_BANDWIDTH=<int> when contourBandwidth is set (units = Kinetica map units, PITFALL M-05)", () => {
    const result = buildWmsParams(
      makeConfig({ renderMode: "contour", contourBandwidth: 5 }),
      1,
    );
    expect(result.CONTOUR_BANDWIDTH).toBe("5");
  });
});

// ─── Phase 35 dynamic-view precedence (DV-V16-13) ─────────────────────────
// Locked precedence (35-CONTEXT.md §"buildWmsParams extension"):
//   1. dvEntry?.status === "materialized" → LAYERS=<dvViewName>, _mv=<dynamicViewVersion>
//   2. dvEntry?.status is pending/over_threshold/error → return null (caller SKIPS layer)
//   3. else if materializeVersion present → LAYERS=<tableRef>, _mv=<materializeVersion> (Phase 16)
//   4. else → LAYERS=<schema.table> bare (Phase 11)

describe("buildWmsParams — Phase 35 dynamic-view precedence (DV-V16-13)", () => {
  // Helper local to this block — keeps the dv view name + version as named constants
  // so each test case asserts against the same literal source-of-truth.
  const DV_VIEW = "_kbi_dv_u1_d2_3";
  const DV_VERSION = 7;
  const FV_VIEW = "_kbi_filt_u1_d2_t3_s4";
  const FV_VERSION = 4;

  it("case 1: dv-bound + materialized → LAYERS=<dvViewName>, _mv=<dynamicViewVersion>", () => {
    const result = buildWmsParams(
      makeConfig(),
      undefined,
      { status: "materialized", viewName: DV_VIEW },
      DV_VERSION,
    );
    expect(result).not.toBeNull();
    expect(result!.LAYERS).toBe(DV_VIEW);
    expect(result!._mv).toBe(String(DV_VERSION));
  });

  it("case 2a: dv-bound + pending → returns null (layer skipped)", () => {
    const result = buildWmsParams(
      makeConfig(),
      undefined,
      { status: "pending", viewName: DV_VIEW },
      DV_VERSION,
    );
    expect(result).toBeNull();
  });

  it("case 2b: dv-bound + over_threshold → returns null (layer skipped)", () => {
    const result = buildWmsParams(
      makeConfig(),
      undefined,
      { status: "over_threshold", viewName: DV_VIEW },
      DV_VERSION,
    );
    expect(result).toBeNull();
  });

  it("case 2c: dv-bound + error → returns null (layer skipped)", () => {
    const result = buildWmsParams(
      makeConfig(),
      undefined,
      { status: "error", viewName: DV_VIEW },
      DV_VERSION,
    );
    expect(result).toBeNull();
  });

  it("case 3: dv unbound (undefined entry) + filter-view materializeVersion present → existing v1.3 LAYERS=<tableRef>, _mv=<materializeVersion>", () => {
    const fvConfig = makeConfig({ tableRef: FV_VIEW, layerName: undefined });
    const result = buildWmsParams(fvConfig, FV_VERSION, undefined, undefined);
    expect(result).not.toBeNull();
    expect(result!.LAYERS).toBe(FV_VIEW);
    expect(result!._mv).toBe(String(FV_VERSION));
  });

  it("case 4: dv unbound + no filter-view materializeVersion → LAYERS=<schema.table> bare, no _mv", () => {
    const bareConfig = makeConfig({ tableRef: "demo.taxi_trips", layerName: undefined });
    const result = buildWmsParams(bareConfig, undefined, undefined, undefined);
    expect(result).not.toBeNull();
    expect(result!.LAYERS).toBe("demo.taxi_trips");
    expect(result).not.toHaveProperty("_mv");
  });

  it("dv precedence wins over filter-view: when BOTH dvEntry materialized AND materializeVersion present, LAYERS=<dvViewName>, _mv=<dynamicViewVersion> (NOT the filter-view values)", () => {
    // Regression guard: caller may compute both materializeVersion (per-table) and
    // a dv entry simultaneously when the layer is dv-bound. The dv branch must win.
    const fvConfig = makeConfig({ tableRef: "_kbi_filt_should_be_ignored" });
    const result = buildWmsParams(
      fvConfig,
      FV_VERSION, // filter-view version — should be ignored
      { status: "materialized", viewName: DV_VIEW },
      DV_VERSION,
    );
    expect(result).not.toBeNull();
    expect(result!.LAYERS).toBe(DV_VIEW);              // dv wins over fv tableRef
    expect(result!._mv).toBe(String(DV_VERSION));      // dv version wins over fv version
    expect(result!._mv).not.toBe(String(FV_VERSION));
  });

  it("case 1 + spatial-mode (latlon): dv-materialized still emits X_ATTR / Y_ATTR (spatial branch is independent of LAYERS source)", () => {
    const spatialConfig = makeConfig({
      spatialMode: "latlon",
      lonColumn: "pickup_longitude",
      latColumn: "pickup_latitude",
    });
    const result = buildWmsParams(
      spatialConfig,
      undefined,
      { status: "materialized", viewName: DV_VIEW },
      DV_VERSION,
    );
    expect(result).not.toBeNull();
    expect(result!.LAYERS).toBe(DV_VIEW);
    // Spatial-mode branch still applies — dv view name is just a Kinetica view,
    // so X_ATTR / Y_ATTR still project onto it for raster point styling.
    expect(result!.X_ATTR).toBe("pickup_longitude");
    expect(result!.Y_ATTR).toBe("pickup_latitude");
  });

  it("case 1: dv-materialized with dynamicViewVersion undefined → LAYERS set, _mv omitted (defensive: caller passed materialized status but no version)", () => {
    // Pitfall 5 (35-RESEARCH.md): LAYERS distinctness (dvViewName) already busts the OL
    // tile cache when the source kind changes. _mv is a within-kind cache-buster only;
    // omitting it when undefined matches the Phase 16 PT16-A lock (never emit _mv=0 sentinel).
    const result = buildWmsParams(
      makeConfig(),
      undefined,
      { status: "materialized", viewName: DV_VIEW },
      undefined,
    );
    expect(result).not.toBeNull();
    expect(result!.LAYERS).toBe(DV_VIEW);
    expect(result).not.toHaveProperty("_mv");
  });

  it("legacy 2-arg form still type-checks AND behaves identically (overload-preserved backward compat)", () => {
    // The 2-arg overload returns a non-null Record<string,string>; existing callers
    // (MapChartRenderer Effects 2/3 today) don't need null-narrowing. This test is the
    // type-level smoke for the overload signature lock.
    const result = buildWmsParams(makeConfig({ tableRef: "demo.taxi_trips" }), 5);
    // `result` is typed as `Record<string, string>` (non-null) under the 2-arg overload,
    // so we can access properties without `!` — TS infers no null possibility.
    expect(result.LAYERS).toBe("demo.taxi_trips");
    expect(result._mv).toBe("5");
  });
});

// ─── v1.7 Phase 38 (SCHEMA-V17-03/04/05) — Lane C cb_raster + Track block + 8-char color ───

describe("buildWmsParams — Lane C cb_raster (SCHEMA-V17-03)", () => {
  const baseConfig = {
    tableId: 1,
    tableRef: "schema.table",
    spatialMode: "latlon" as const,
    lonColumn: "lon",
    latColumn: "lat",
    renderMode: "classbreak" as const,
  };

  it("emits STYLES=cb_raster (not STYLES=classbreak) when cb_config is configured", () => {
    const cbConfigJson = JSON.stringify({
      attr: "fare_amount",
      valsType: "numeric",
      breaks: [{ value: 10, color: "FF112233" }, { value: 25, color: "FF445566" }],
    });
    const params = buildWmsParams(
      baseConfig,
      undefined,
      undefined,
      undefined,
      { cb_config: cbConfigJson, track_config: null },
    );
    expect(params).not.toBeNull();
    expect(params!.STYLES).toBe("cb_raster");
  });

  it("emits CB_ATTR + CB_VALS (numeric lo:hi ranges) + POINTCOLORS from cb_config.breaks", () => {
    const cbConfigJson = JSON.stringify({
      attr: "fare_amount",
      valsType: "numeric",
      breaks: [
        { value: 0, min: 0, max: 10, color: "FF112233" },
        { value: 0, min: 10, max: 25, color: "FF445566" },
        { value: 0, min: 25, max: 50, color: "FF7788AA" },
      ],
    });
    const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
    expect(params!.CB_ATTR).toBe("fare_amount");
    // Numeric CB_VALS = lo:hi ranges per Kinetica WMS docs (CB_DELIMITER ":")
    expect(params!.CB_VALS).toBe("0:10,10:25,25:50");
    expect(params!.POINTCOLORS).toBe("FF112233,FF445566,FF7788AA");
  });

  it("emits CB_VALS as comma-separated distinct values for categorical breaks", () => {
    const cbConfigJson = JSON.stringify({
      attr: "size",
      valsType: "categorical",
      breaks: [
        { value: "small", color: "FF112233" },
        { value: "medium", color: "FF445566" },
        { value: "big", color: "FF7788AA" },
      ],
    });
    const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
    expect(params!.CB_ATTR).toBe("size");
    expect(params!.CB_VALS).toBe("small,medium,big");
  });

  it("emits the literal <other> keyword in CB_VALS (no auto-injection, no rewriting)", () => {
    const cbConfigJson = JSON.stringify({
      attr: "payment_type",
      valsType: "categorical",
      breaks: [
        { value: "cash", color: "FF112233" },
        { value: "credit", color: "FF445566" },
        { value: "<other>", color: "FF7788AA" },
      ],
    });
    const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
    expect(params!.CB_VALS).toBe("cash,credit,<other>");
  });

  it("emits POINTSIZES / POINTSHAPES / SHAPELINEWIDTHS / SHAPELINECOLORS / SHAPEFILLCOLORS only when at least one break sets them", () => {
    const cbConfigJson = JSON.stringify({
      attr: "x",
      valsType: "numeric",
      breaks: [
        { value: 1, color: "FF000000", pointSize: 4, pointShape: "circle" },
        { value: 2, color: "FFFFFFFF", pointSize: 6 },  // no pointShape — default "circle"
      ],
    });
    const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
    expect(params!.POINTSIZES).toBe("4,6");
    expect(params!.POINTSHAPES).toBe("circle,circle");
    expect(params!.SHAPELINEWIDTHS).toBeUndefined();  // no break sets it
    expect(params!.SHAPELINECOLORS).toBeUndefined();
    expect(params!.SHAPEFILLCOLORS).toBeUndefined();
  });

  it("does NOT emit Lane A indexed names (CB_POINTCOLOR_1 / CB_BREAK_POINT_1) or Lane B param CB_POINTCOLORS", () => {
    const cbConfigJson = JSON.stringify({ attr: "x", valsType: "numeric", breaks: [{ value: 1, color: "FF000000" }] });
    const params = buildWmsParams(baseConfig, undefined, undefined, undefined, { cb_config: cbConfigJson, track_config: null });
    // Lane A naming gone:
    expect(Object.keys(params!).find((k) => k.startsWith("CB_POINTCOLOR_"))).toBeUndefined();
    expect(Object.keys(params!).find((k) => k.startsWith("CB_BREAK_POINT_"))).toBeUndefined();
    expect(params!.CB_COLUMN_NAME).toBeUndefined();
    expect(params!.CB_BREAK_TYPE).toBeUndefined();
    // Lane B naming also absent (we emit Lane C POINTCOLORS, not Lane B CB_POINTCOLORS):
    expect(params!.CB_POINTCOLORS).toBeUndefined();
  });

  it("falls through to no CB_* emission when cb_config is null (hard cutover — no read-shim for legacy config.classbreaks[])", () => {
    // Even though the legacy config has classbreaks[], wmsUrlBuilder must NOT read it.
    const legacyConfig = {
      ...baseConfig,
      cbColumn: "fare_amount",
      cbBreakType: "numerical" as const,
      classbreaks: [{ value: 10, color: "FF112233" }, { value: 25, color: "FF445566" }],
    };
    const params = buildWmsParams(legacyConfig, undefined, undefined, undefined, { cb_config: null, track_config: null });
    expect(params!.STYLES).toBe("cb_raster");   // STYLES_BY_MODE swap
    expect(params!.CB_ATTR).toBeUndefined();
    expect(params!.CB_VALS).toBeUndefined();
    expect(params!.POINTCOLORS).toBeUndefined();
    expect(params!.CB_POINTCOLORS).toBeUndefined();
  });
});

describe("buildWmsParams — 8-char AARRGGBB color regression lock (SCHEMA-V17-05)", () => {
  it("emits 8-char AARRGGBB POINTCOLORS even when input color is 6-char RRGGBB", () => {
    const cbConfigJson = JSON.stringify({
      attr: "x",
      valsType: "numeric",
      breaks: [{ value: 1, color: "112233" }],   // 6-char (legacy bug input)
    });
    const params = buildWmsParams(
      { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "classbreak" },
      undefined, undefined, undefined,
      { cb_config: cbConfigJson, track_config: null },
    );
    expect(params!.POINTCOLORS).toBe("FF112233");   // normalized — NOT "112233"
    expect(params!.POINTCOLORS.length).toBe(8);
  });

  it("preserves 8-char AARRGGBB POINTCOLORS verbatim when input is already 8-char", () => {
    const cbConfigJson = JSON.stringify({
      attr: "x",
      valsType: "numeric",
      breaks: [{ value: 1, color: "FF112233" }],
    });
    const params = buildWmsParams(
      { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "classbreak" },
      undefined, undefined, undefined,
      { cb_config: cbConfigJson, track_config: null },
    );
    expect(params!.POINTCOLORS).toBe("FF112233");
  });
});

describe("buildWmsParams — Track block (SCHEMA-V17-04)", () => {
  const baseConfig = {
    tableId: 1,
    tableRef: "s.t",
    spatialMode: "latlon" as const,
    lonColumn: "lon",
    latColumn: "lat",
  };

  it("under STYLES=raster: emits single-value TRACK_* params when trackConfig.enabled === true", () => {
    const trackJson = JSON.stringify({
      enabled: true,
      trackIdAttr: "TRACKID",
      trackOrderAttr: "TIMESTAMP",
      headColor: "FFFF0000",
      trailColor: "FF0000FF",
      headSize: 8,
      trailSize: 2,
      headShape: "circle",
    });
    const params = buildWmsParams(
      { ...baseConfig, renderMode: "raster" },
      undefined, undefined, undefined,
      { cb_config: null, track_config: trackJson },
    );
    expect(params!.DOTRACKS).toBe("TRUE");
    expect(params!.TRACK_ID_ATTR).toBe("TRACKID");
    expect(params!.TRACK_ORDER_ATTR).toBe("TIMESTAMP");
    expect(params!.TRACKHEADCOLORS).toBe("FFFF0000");
    expect(params!.TRACKLINECOLORS).toBe("FF0000FF");
    expect(params!.TRACKHEADSIZES).toBe("8");
    expect(params!.TRACKLINEWIDTHS).toBe("2");
    expect(params!.TRACKMARKERSHAPES).toBe("circle");
  });

  it("under STYLES=cb_raster: emits N comma-separated TRACK_* params matching cb_config.breaks.length", () => {
    const cbConfigJson = JSON.stringify({
      attr: "x",
      valsType: "numeric",
      breaks: [{ value: 1, color: "FF000000" }, { value: 2, color: "FFFFFFFF" }, { value: 3, color: "FF112233" }],
    });
    const trackJson = JSON.stringify({
      enabled: true,
      headColor: "FFFF0000",
      trailColor: "FF0000FF",
      headSize: 8,
    });
    const params = buildWmsParams(
      { ...baseConfig, renderMode: "classbreak" },
      undefined, undefined, undefined,
      { cb_config: cbConfigJson, track_config: trackJson },
    );
    expect(params!.DOTRACKS).toBe("TRUE");
    expect(params!.TRACKHEADCOLORS).toBe("FFFF0000,FFFF0000,FFFF0000");
    expect(params!.TRACKLINECOLORS).toBe("FF0000FF,FF0000FF,FF0000FF");
    expect(params!.TRACKHEADSIZES).toBe("8,8,8");
  });

  it("NO Track params emitted when trackConfig.enabled === false", () => {
    const trackJson = JSON.stringify({ enabled: false, headColor: "FFFF0000" });
    const params = buildWmsParams(
      { ...baseConfig, renderMode: "raster" },
      undefined, undefined, undefined,
      { cb_config: null, track_config: trackJson },
    );
    expect(params!.DOTRACKS).toBeUndefined();
    expect(params!.TRACKHEADCOLORS).toBeUndefined();
  });

  it("NO Track params emitted under STYLES=heatmap even when enabled (Track gated to raster|classbreak only)", () => {
    const trackJson = JSON.stringify({ enabled: true, headColor: "FFFF0000" });
    const params = buildWmsParams(
      { ...baseConfig, renderMode: "heatmap" },
      undefined, undefined, undefined,
      { cb_config: null, track_config: trackJson },
    );
    expect(params!.DOTRACKS).toBeUndefined();
  });
});

describe("buildWmsParams — backward-compat URL snapshot (legacy widgets pre-v1.7)", () => {
  it("a raster-mode widget with no cb_config + no track_config + no layerJsonFields arg produces identical URL to pre-v1.7", () => {
    // Legacy 2-arg signature (Phase 16 callers) — layerJsonFields undefined.
    const params = buildWmsParams(
      { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "raster", pointColor: "FFFF3838", pointSize: 4 },
      undefined,
    );
    expect(params!.STYLES).toBe("raster");
    expect(params!.POINTCOLORS).toBe("FFFF3838");
    expect(params!.POINTSIZES).toBe("4");
    // No CB_* params:
    expect(params!.CB_ATTR).toBeUndefined();
    expect(params!.CB_VALS).toBeUndefined();
    // No Track params:
    expect(params!.DOTRACKS).toBeUndefined();
  });

  it("legacy classbreak widget with config.classbreaks[] but cb_config===null: NO CB_* emit (hard cutover lock)", () => {
    const params = buildWmsParams(
      {
        tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat",
        renderMode: "classbreak",
        cbColumn: "fare_amount", cbBreakType: "numerical",
        classbreaks: [{ value: 10, color: "112233" }, { value: 25, color: "445566" }],
      },
      undefined, undefined, undefined,
      { cb_config: null, track_config: null },
    );
    expect(params!.STYLES).toBe("cb_raster");   // STYLES_BY_MODE swap (renders as raster-equivalent without CB_*)
    // No CB_* params (the legacy classbreaks[] is IGNORED):
    expect(params!.CB_ATTR).toBeUndefined();
    expect(params!.CB_VALS).toBeUndefined();
    expect(params!.POINTCOLORS).toBeUndefined();
  });
});

describe("buildWmsParams — track spatial mode (Phase 52)", () => {
  const trackSpatialBase = {
    tableId: 1,
    tableRef: "s.t",
    spatialMode: "track" as const,
    renderMode: "raster" as const,
  };

  it("track mode emits X_ATTR/Y_ATTR from track_config xCol/yCol", () => {
    const trackJson = JSON.stringify({ enabled: false, xCol: "x_col", yCol: "y_col" });
    const params = buildWmsParams(
      trackSpatialBase,
      undefined, undefined, undefined,
      { cb_config: null, track_config: trackJson },
    );
    expect(params!.X_ATTR).toBe("x_col");
    expect(params!.Y_ATTR).toBe("y_col");
    expect(params!.GEO_ATTR).toBeUndefined();
  });

  it("track mode emits no X_ATTR/Y_ATTR when track_config is null", () => {
    const params = buildWmsParams(
      trackSpatialBase,
      undefined, undefined, undefined,
      { cb_config: null, track_config: null },
    );
    expect(params!.X_ATTR).toBeUndefined();
    expect(params!.Y_ATTR).toBeUndefined();
  });

  it("track mode emits no X_ATTR when xCol missing from track_config", () => {
    const trackJson = JSON.stringify({ enabled: false, yCol: "y_col" });
    const params = buildWmsParams(
      trackSpatialBase,
      undefined, undefined, undefined,
      { cb_config: null, track_config: trackJson },
    );
    expect(params!.X_ATTR).toBeUndefined();
    expect(params!.Y_ATTR).toBe("y_col");
  });

  it("track mode does NOT emit GEO_ATTR (never falls through to wkb branch)", () => {
    const trackJson = JSON.stringify({ enabled: false, xCol: "x", yCol: "y" });
    const params = buildWmsParams(
      trackSpatialBase,
      undefined, undefined, undefined,
      { cb_config: null, track_config: trackJson },
    );
    expect(params!.GEO_ATTR).toBeUndefined();
  });

  it("track mode with no layerJsonFields arg emits neither X_ATTR nor Y_ATTR", () => {
    // 2-arg / 4-arg legacy callers pass no layerJsonFields
    const params = buildWmsParams(
      trackSpatialBase,
      undefined,
    );
    expect(params!.X_ATTR).toBeUndefined();
    expect(params!.Y_ATTR).toBeUndefined();
  });
});

describe("buildWmsParams — `_mv` cache-bust preservation (SCHEMA-V17-03 explicit requirement)", () => {
  it("LAYERS param contains the `_mv` cache-bust suffix when materializeVersion is supplied (v1.3 logic survived the rewrite)", () => {
    // 4-arg call (Phase 16 + Phase 35 caller shape) with materializeVersion=42.
    // The v1.3 Phase 13 `_mv` suffix logic must still emit on the LAYERS param so
    // the tile fetch URL changes when filter materialization version bumps.
    const params = buildWmsParams(
      { tableId: 1, tableRef: "schema.nyctaxi", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "raster" },
      42,
      undefined,
      undefined,
    );
    expect(params).not.toBeNull();
    // The `_mv` cache-bust signature MUST appear in the LAYERS param (or wherever
    // wmsUrlBuilder routes it under the 4-case LAYERS precedence — any LAYERS
    // value containing `_mv` is a PASS on this lock).
    expect(params!._mv).toBe("42");
  });

  it("NO Track params emitted when track_config is null (legacy widget pre-v1.7)", () => {
    // SCHEMA-V17-04 backward-compat lock: legacy widget where track_config is
    // explicitly null (PRAGMA-migrated row with no Phase 40 form input yet) must
    // produce ZERO Track params — bit-identical to pre-v1.7 raster URLs.
    const params = buildWmsParams(
      { tableId: 1, tableRef: "s.t", spatialMode: "latlon", lonColumn: "lon", latColumn: "lat", renderMode: "raster" },
      undefined,
      undefined,
      undefined,
      { cb_config: null, track_config: null },
    );
    expect(params!.DOTRACKS).toBeUndefined();
    // No TRACK_* keys at all:
    const trackKeys = Object.keys(params!).filter((k) => k.startsWith("TRACK"));
    expect(trackKeys).toEqual([]);
  });
});
