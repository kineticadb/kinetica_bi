/**
 * v1.7 Phase 38 (SCHEMA-V17-07): pure helper module for classbreak config
 * JSON shape carried on dashboard_layers.cb_config. Mirrors v1.4 Phase 19
 * mapInfoConfig.ts + v1.5 Phase 28 spatialTargets.ts pattern — pure types
 * + EMPTY constant + null-coalescer + type-narrowing predicates. No Zod,
 * no React, no Zustand. JSON.parse at the boundary; everything else passes
 * the parsed shape through.
 *
 * The cb_config JSON string is set via Phase 39 form UI (CB-V17-01..09)
 * and round-trips through the server via Plan 38-01 PATCH route. Phase 38-02
 * wmsUrlBuilder reads it via coalesceCbConfig(layer.cb_config) before
 * emitting Lane C params under STYLES=cb_raster.
 *
 * Type-narrowing predicates (isNumericValsType / isCategoricalValsType)
 * pre-stage Phase 39's numeric-vs-categorical branch UI — wmsUrlBuilder
 * does NOT branch on valsType; it serializes breaks[].value verbatim into
 * comma-separated CB_VALS (Kinetica accepts both numeric strings and
 * string-form categorical values under the same param).
 */

export type CbBreak = {
  /** Categorical break value (string). Used when valsType="categorical". Supports the
   *  literal "<other>" keyword as a sink-bucket value (Phase 37 SPIKE-V17-02 OQ-3 PASS —
   *  Kinetica accepts the verbatim <other> keyword). For numeric breaks this field is
   *  unused — numeric ranges are carried in min/max below. */
  value: string | number;
  /** Numeric-range lower bound (INCLUSIVE). Used only when valsType="numeric".
   *  Emitted as the `lo` half of each CB_VALS `lo:hi` range per Kinetica WMS docs
   *  (CB_DELIMITER ":"; start inclusive, end exclusive). */
  min?: number;
  /** Numeric-range upper bound (EXCLUSIVE). Used only when valsType="numeric".
   *  Emitted as the `hi` half of each CB_VALS `lo:hi` range. */
  max?: number;
  /** 8-char AARRGGBB hex. Phase 38-02 wmsUrlBuilder normalizes via normalizeAARRGGBB
   *  (colorHex.ts:30) before emitting POINTCOLORS — legacy 6-char values become
   *  FF + RRGGBB. Phase 39 form's color picker writes 8-char by default. */
  color: string;
  /** Optional per-break legend label. Pure client-side presentation (Phase 41
   *  LayersLegendPanel reads this directly from cb_config); NOT emitted in WMS URL. */
  label?: string;
  /** Optional per-break point size (Lane C POINTSIZES comma-separated emission). */
  pointSize?: number;
  /** Optional per-break point shape (Lane C POINTSHAPES — circle/square/diamond/triangle). */
  pointShape?: string;
  /** Optional per-break shape line width (Lane C SHAPELINEWIDTHS). */
  shapeLineWidth?: number;
  /** Optional per-break shape line color (Lane C SHAPELINECOLORS, 8-char AARRGGBB). */
  shapeLineColor?: string;
  /** Optional per-break shape fill color (Lane C SHAPEFILLCOLORS, 8-char AARRGGBB). */
  shapeFillColor?: string;
};

export type CbConfig = {
  /** CB_ATTR column name. Empty string signals "not yet configured". */
  attr: string;
  /** Numeric (INT/DOUBLE/FLOAT/DECIMAL) vs categorical (TEXT/CHAR) source column.
   *  Phase 39 form's CB column picker auto-defaults based on column type;
   *  operator can override. wmsUrlBuilder does NOT branch on this — it
   *  serializes breaks[].value verbatim. */
  valsType: "numeric" | "categorical";
  /** Per-break entries. Empty array signals "not yet configured" (wmsUrlBuilder
   *  cb_raster branch skips emission when breaks.length === 0). */
  breaks: CbBreak[];
  /** Phase 39 form UI flag: pre-populate an <other> sink-bucket row when
   *  toggled ON (CB-V17-04). wmsUrlBuilder does NOT auto-inject — Phase 39
   *  form is responsible for placing the row in breaks[]. */
  includeOtherBucket?: boolean;
};

/** Backward-compat default for layers whose cb_config is NULL (pre-Phase-38 rows
 *  or operator-cleared rows). wmsUrlBuilder's cb_raster branch checks
 *  isCbConfigConfigured(coalesceCbConfig(raw)) before emitting any CB_* params;
 *  EMPTY_CB_CONFIG always reads as "not configured" so legacy rows render as raster. */
export const EMPTY_CB_CONFIG: CbConfig = {
  attr: "",
  valsType: "numeric",
  breaks: [],
};

/**
 * Parse raw cb_config JSON string. Returns EMPTY_CB_CONFIG on null or any parse
 * failure (NEVER throws). JSON validation is best-effort — Phase 39 form's
 * client-side validation is the trust boundary for shape integrity; this helper
 * only guards the read path against corrupt/null/legacy values.
 */
export function coalesceCbConfig(raw: string | null): CbConfig {
  if (raw === null) return EMPTY_CB_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "attr" in parsed && "breaks" in parsed) {
      return parsed as CbConfig;
    }
    return EMPTY_CB_CONFIG;
  } catch {
    return EMPTY_CB_CONFIG;
  }
}

/** True when attr is non-empty AND breaks.length > 0. Used by wmsUrlBuilder
 *  cb_raster branch to gate Lane C emission. */
export function isCbConfigConfigured(cfg: CbConfig): boolean {
  return cfg.attr.length > 0 && cfg.breaks.length > 0;
}

/** Type-narrowing predicate for numeric breaks UX (Phase 39 CB-V17-03). */
export function isNumericValsType(cfg: CbConfig): boolean {
  return cfg.valsType === "numeric";
}

/** Type-narrowing predicate for categorical breaks UX (Phase 39 CB-V17-04). */
export function isCategoricalValsType(cfg: CbConfig): boolean {
  return cfg.valsType === "categorical";
}

// ─── Phase 39 Plan 01: palette + helpers ─────────────────────────────────────

/** Default 8-color sequential palette for new break rows. Phase 39 CB form uses
 *  PALETTE_COLORS[index % PALETTE_COLORS.length] for the color of newly-added rows
 *  (Add break, Auto-suggest fill, <other> toggle-ON). Phase 41 LayersLegendPanel
 *  reads break colors directly from cb_config.breaks[].color, not from this palette
 *  (palette is only used at row-creation time). */
export const PALETTE_COLORS: readonly string[] = [
  "FF3B82F6", // blue-500
  "FFEF4444", // red-500
  "FF10B981", // emerald-500
  "FFF59E0B", // amber-500
  "FF8B5CF6", // violet-500
  "FFEC4899", // pink-500
  "FF14B8A6", // teal-500
  "FF6B7280", // gray-500
];

/** Materialize a fully-populated CbBreak with all 5 advanced fields set to defaults.
 *  Phase 39 form invariant: every break row has all 5 advanced fields populated so
 *  wmsUrlBuilder never receives undefined values in CSV emission (POINTSIZES, POINTSHAPES,
 *  SHAPELINEWIDTHS, SHAPELINECOLORS, SHAPEFILLCOLORS). */
export function createDefaultBreak(
  valsType: "numeric" | "categorical",
  index: number,
): CbBreak {
  return {
    value: valsType === "numeric" ? 0 : "",
    // Numeric breaks carry a lo:hi range (CB_VALS); categorical breaks use `value`.
    ...(valsType === "numeric" ? { min: 0, max: 0 } : {}),
    color: PALETTE_COLORS[index % PALETTE_COLORS.length],
    label: "",
    pointSize: 5,
    pointShape: "circle",
    shapeLineWidth: 1,
    shapeLineColor: "FF000000",
    shapeFillColor: "FFFFFFFF",
  };
}

const NUMERIC_TYPES = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "double precision", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);
// Kinetica INFORMATION_SCHEMA.DATA_TYPE returns char columns as "character(N)"
// (e.g. vendor_id → "character(256)"); the "(N)" suffix is stripped by the caller's
// normalize step, leaving "character". Include all string-family spellings so
// categorical CB columns aren't silently excluded.
const STRING_TYPES = new Set([
  "string", "varchar", "char", "character", "nchar", "nvarchar", "text",
]);

/** Filter the column list to CB-eligible columns. Mirrors v1.2 Phase 11 logic plus
 *  Phase 39 additions: (a) exclude WKB-binary columns (type contains "bytes" or "wkb"
 *  case-insensitive) per CB-V17-08; (b) exclude columns already bound to spatial config
 *  (lat/lon/wkt/wkb) for visual de-clutter. Type-suffix stripping handles `varchar(255)`
 *  and `decimal(10,2)` style declarations. */
export function filterCbEligibleColumns(
  columns: { name: string; type: string }[],
  spatialBound?: Set<string>,
): { name: string; type: string }[] {
  return columns.filter((c) => {
    const rawType = c.type.toLowerCase();
    // CB-V17-08: WKB exclusion
    if (rawType.includes("bytes") || rawType.includes("wkb")) return false;
    // Spatial-bound exclusion (visual de-clutter)
    if (spatialBound && spatialBound.has(c.name)) return false;
    const t = rawType.replace(/\(.*\)/, "").trim();
    return NUMERIC_TYPES.has(t) || STRING_TYPES.has(t);
  });
}

/** Auto-detect valsType from a column's type. Numeric columns default to "numeric";
 *  string columns default to "categorical". Returns "numeric" as the safe fallback
 *  for unknown types (caller should have already filtered via filterCbEligibleColumns). */
export function detectValsTypeFromColumn(
  column: { name: string; type: string } | undefined,
): "numeric" | "categorical" {
  if (!column) return "numeric";
  const t = column.type.toLowerCase().replace(/\(.*\)/, "").trim();
  if (STRING_TYPES.has(t)) return "categorical";
  return "numeric";
}
