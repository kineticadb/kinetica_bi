/**
 * Phase 10 drill-down column-type utilities.
 *
 * - isColumnDrillDownSafe: PITFALL D-01 lock. Excludes Kinetica geometry types
 *   and large-text types from the drill-down column picker. Equality filters on
 *   these are nonsensical and would silently fail or produce unhelpful results.
 * - inferDataTypeFromColumn: maps a Kinetica DATA_TYPE string (from
 *   INFORMATION_SCHEMA.COLUMNS, surfaced via TableDto.columns) to the
 *   ActiveFilter.dataType union — needed by ChartConfigPanel to persist
 *   widget.config.drillDownColumnType at save time, so renderers don't need
 *   runtime column-type lookups (PITFALL: render path has no TableDto.columns
 *   in scope; resolve at config time).
 * - buildChipText: produces the human-readable filter chip text used in the
 *   filter bar AND the confirmation toast (DRILL-04 success criterion #5).
 *   This is DISPLAY ONLY. SQL safety lives in filterStore.ts buildEqualityFilter
 *   (AP-3 lock — never bypass).
 */

import { isTrackTable } from "./trackDetect";

/** Mirrors filterStore.ts ActiveFilter["dataType"]. Single source of truth for downstream consumers. */
export type DrillDownDataType = "string" | "number" | "boolean" | "datetime" | "null";

// PITFALL D-01 lock: Kinetica geometry + large-text types excluded from drill-down picker.
// Type strings are lowercased Kinetica DATA_TYPE values from INFORMATION_SCHEMA.COLUMNS
// (packages/server/src/index.ts:642-654). MEDIUM confidence per .planning/phases/10-existing-chart-drill-down/10-RESEARCH.md
// Open Question #1 — conservative pass-through for unknown types means an unknown spatial
// type would slip into the picker (acceptable: over-exclusion would hide valid columns).
const EXCLUDED_DRILLDOWN_TYPES: ReadonlySet<string> = new Set([
  "wkt",
  "wkb",
  "bytes",
  "blob",
  "text",
  "point",
  "geometry",
  "geography",
]);

// Numeric types — copied verbatim from ChartConfigPanel.tsx NUMERIC_TYPES (lines 40-44).
// Keep in sync if ChartConfigPanel adds more.
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "float", "double", "double precision", "decimal", "numeric",
  "smallint", "bigint", "real", "number", "tinyint",
]);

// Integer-class subset of NUMERIC_TYPES. Phase 44 follow-up: CbConfigForm uses
// this to choose the nudge size when closing the last class-break bucket so
// rows with value === colMax still get classified (Kinetica CB_VALS upper
// bound is EXCLUSIVE). Integer columns nudge by +1 (preserves clean integer
// boundaries); float/decimal columns nudge by a tiny epsilon (round2 precision).
const INTEGER_TYPES: ReadonlySet<string> = new Set([
  "int", "integer", "int8", "int16", "int32", "int64",
  "long", "smallint", "bigint", "tinyint",
]);

/** True when the column's Kinetica type is integer-class (INT / LONG / SMALLINT / etc). */
export function isIntegerColumnType(colType: string | undefined | null): boolean {
  if (!colType) return false;
  return INTEGER_TYPES.has(normalizeType(colType));
}

const BOOLEAN_TYPES: ReadonlySet<string> = new Set(["bool", "boolean"]);
const DATETIME_TYPES: ReadonlySet<string> = new Set(["timestamp", "date", "time", "datetime"]);

/** Normalize: lowercase, strip parameterized suffix `(N)`, trim. Matches ChartConfigPanel.tsx isNumericType. */
function normalizeType(colType: string): string {
  return colType.toLowerCase().replace(/\(.*\)/, "").trim();
}

/**
 * PITFALL D-01 lock: returns false for Kinetica geometry + large-text types.
 * Returns true for everything else (conservative pass-through for unknown types).
 */
export function isColumnDrillDownSafe(colType: string): boolean {
  const t = normalizeType(colType);
  return !EXCLUDED_DRILLDOWN_TYPES.has(t);
}

/**
 * Maps a Kinetica DATA_TYPE string to ActiveFilter.dataType.
 * Returns "null" if column is missing from the map (renderer signal: pre-config widget).
 */
export function inferDataTypeFromColumn(
  colName: string,
  columns: Record<string, string>,
): DrillDownDataType {
  const raw = columns[colName];
  if (raw === undefined || raw === null) return "null";
  const t = normalizeType(raw);
  if (t === "") return "null";
  if (NUMERIC_TYPES.has(t)) return "number";
  if (BOOLEAN_TYPES.has(t)) return "boolean";
  if (DATETIME_TYPES.has(t)) return "datetime";
  return "string";
}

// Phase 68-01: Month abbreviation table (UTC, consistent with CalendarRenderer tooltip).
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Formats a datetime BETWEEN range as a human-readable inclusive string.
 * Used exclusively by buildChipText when dataType==="datetime" + operator==="between".
 *
 * Rules:
 *  - Always uses UTC getters (getUTCFullYear/Month/Date/Hours) — NEVER local getters.
 *  - The stored `hiIso` is nextBucketStart − 1ms (e.g. "…23:59:59.999Z"). The inclusive
 *    human end is the day/hour that CONTAINS hiMs, not the next one.
 *  - Single day (lo and hi fall on the same UTC calendar day) → "Mon D, YYYY" (no en-dash).
 *  - Sub-day range (hiMs − loMs < 24 h) → "Mon D, YYYY HH:00 – Mon D, YYYY HH:00"
 *    (or collapsed if same day+hour on both ends).
 *  - Multi-day range → "Mon D – Mon D, YYYY" (year omitted on start if same year).
 *
 * The en-dash separator is U+2013, matching the Phase 68 chip-copy spec.
 */
function formatDatetimeRange(loIso: string, hiIso: string): string {
  const loMs = new Date(loIso).getTime();
  const hiMs = new Date(hiIso).getTime();

  const rangeMs = hiMs - loMs;

  // Helper: UTC date parts
  const parts = (ms: number) => {
    const d = new Date(ms);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(), // 0-indexed
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
    };
  };

  const lo = parts(loMs);
  const hi = parts(hiMs); // the day/hour that contains hiMs (inclusive human end)

  const fmtDay = (p: { year: number; month: number; day: number }) =>
    `${MONTH_NAMES[p.month]} ${p.day}, ${p.year}`;

  const fmtHour = (p: { year: number; month: number; day: number; hour: number }) =>
    `${MONTH_NAMES[p.month]} ${p.day}, ${p.year} ${String(p.hour).padStart(2, "0")}:00`;

  const sameDay =
    lo.year === hi.year && lo.month === hi.month && lo.day === hi.day;

  // Single calendar day: lo and hi land on the same UTC calendar day.
  // This covers both a full-day cell (00:00 → 23:59:59.999) and any sub-day
  // cell whose endpoints share the same date — collapse to a single date.
  if (sameDay) {
    // Sub-day range on the same day: show the hour granularity.
    if (rangeMs < 60 * 60 * 1000) {
      // Single-hour cell (< 1 h, same day and hour)
      return fmtHour(lo);
    }
    if (lo.hour !== 0 || hi.hour !== 23) {
      // Partial-day range (e.g. 14:00–14:59 shows hours)
      return `${fmtDay(lo)} ${String(lo.hour).padStart(2, "0")}:00 – ${String(hi.hour).padStart(2, "0")}:00`;
    }
    // Full-day cell (lo=00:00, hi=23:xx): collapse to date only.
    return fmtDay(lo);
  }

  // Sub-day range that crosses midnight (rare but handled)
  if (rangeMs < 24 * 60 * 60 * 1000) {
    return `${fmtHour(lo)} – ${fmtHour(hi)}`;
  }

  // Multi-day range — omit year from start if same year
  if (lo.year === hi.year) {
    const loStr = `${MONTH_NAMES[lo.month]} ${lo.day}`;
    return `${loStr} – ${MONTH_NAMES[hi.month]} ${hi.day}, ${hi.year}`;
  }

  return `${fmtDay(lo)} – ${fmtDay(hi)}`;
}

/**
 * Produces the filter chip / toast text for a (column, value, dataType, operator?) tuple.
 * DISPLAY ONLY — does NOT SQL-escape. SQL safety is in packages/server/src/lib/whereClause.ts.
 *
 * Phase 44 (FILTER-V17-05): extended for `in` / `between` operators. Format mirrors
 * the locked chip text contract in 44-RESEARCH.md §D:
 *   - in:      `column in ('a', 'b')`              (lowercase 'in'; single-quoted strings)
 *   - in (num):`column in (1, 2, 3)`               (unquoted numbers)
 *   - between: `column between x and y`            (numbers unquoted; strings/dates unquoted in display)
 *
 * The 4th param is optional; legacy callers (drill-down toast at WidgetRenderer.tsx:105)
 * omit it and get the eq path unchanged.
 *
 * Format (DRILL-04 success criterion #5 + UI-SPEC.md Copywriting Contract):
 *   - null:     `column IS NULL`
 *   - string:   `column = 'value'`
 *   - datetime: `column = 'ISO-string'`
 *   - number:   `column = 42`        (unquoted)
 *   - boolean:  `column = TRUE`      (uppercase TRUE/FALSE, matches buildEqualityFilter)
 */
export function buildChipText(
  column: string,
  value: unknown,
  dataType: DrillDownDataType,
  operator: "eq" | "in" | "between" | "isNull" = "eq",
): string {
  // Phase 44 — IN operator display
  if (operator === "in") {
    const arr = Array.isArray(value) ? value : [];
    const items = arr
      .map((v) => (dataType === "number" ? String(v) : `'${v}'`))
      .join(", ");
    return `${column} in (${items})`;
  }

  // Phase 44 — BETWEEN operator display
  if (operator === "between") {
    const tup = Array.isArray(value) && value.length === 2 ? value : [undefined, undefined];
    const [lo, hi] = tup as [unknown, unknown];
    // Phase 68-01: datetime BETWEEN renders as a human-readable inclusive range.
    if (dataType === "datetime") {
      return `${column} between ${formatDatetimeRange(String(lo), String(hi))}`;
    }
    // Numbers display unquoted; strings display unquoted in chips (RESEARCH §D format).
    return `${column} between ${String(lo)} and ${String(hi)}`;
  }

  // eq / isNull / fall-through — PRESERVED VERBATIM from pre-Phase-44 path
  if (dataType === "null" || value === null) return `${column} IS NULL`;
  if (dataType === "string") return `${column} = '${value}'`;
  if (dataType === "datetime") {
    const iso = value instanceof Date ? value.toISOString() : String(value);
    return `${column} = '${iso}'`;
  }
  if (dataType === "boolean") return `${column} = ${value ? "TRUE" : "FALSE"}`;
  // number (or unhandled — fall through to raw stringification, unquoted)
  return `${column} = ${value}`;
}

// Phase 11: Spatial column helpers (MAP-02)
// CONTEXT.md "Spatial-column-mode picker" lock; RESEARCH.md Pattern 6.

export type SpatialMode = "latlon" | "wkt" | "wkb" | "track";
export type Column = { name: string; type: string };

const STRING_TYPES: ReadonlySet<string> = new Set([
  // "character" is Kinetica's INFORMATION_SCHEMA spelling for char(N) columns.
  "string", "varchar", "text", "char", "character", "nchar", "nvarchar",
]);
const KINETICA_GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "geometry", "geography", "wkb", "point",
]);
// WKT-mode predicate is `ST_INTERSECTS(<col>, ST_GEOMFROMTEXT(?))` (Phase 26 spike).
// That works against ANY geometry-compatible column — native Kinetica geometry types
// AND string columns that hold WKT text. The "mode" describes what the BI sends over
// the wire (WKT text), not the column's storage format.
const WKT_HOSTING_TYPES: ReadonlySet<string> = new Set([
  ...STRING_TYPES,
  "wkt",
  ...KINETICA_GEOMETRY_TYPES,
]);

export function getValidSpatialColumns(
  columns: Column[],
  mode: SpatialMode,
): Column[] {
  return columns.filter((c) => {
    const t = normalizeType(c.type);
    if (mode === "latlon") return NUMERIC_TYPES.has(t);
    if (mode === "wkt") return WKT_HOSTING_TYPES.has(t);
    return KINETICA_GEOMETRY_TYPES.has(t); // wkb
  });
}

/**
 * Phase 52: Returns all columns eligible as the Track ID column — any non-geometry column.
 * Both string and numeric IDs are valid track identifiers; geometry columns are excluded
 * (geometry equality comparisons are nonsensical for track ID lookups).
 */
export function getTrackIdColumns(columns: Column[]): Column[] {
  return columns.filter((c) => !KINETICA_GEOMETRY_TYPES.has(normalizeType(c.type)));
}

/**
 * Phase 52: Returns all columns eligible as the Track Order column — datetime and numeric types.
 * Timestamp/date/time/datetime columns and numeric sequence columns are valid ordering keys.
 */
export function getTrackOrderColumns(columns: Column[]): Column[] {
  return columns.filter((c) => {
    const t = normalizeType(c.type);
    return DATETIME_TYPES.has(t) || NUMERIC_TYPES.has(t);
  });
}

export function autoSuggestSpatialMode(
  columns: Column[],
  options?: { preferWktOverWkb?: boolean },
): SpatialMode {
  const preferWkt = options?.preferWktOverWkb === true;

  // Precedence (RESEARCH.md Pattern 6):
  // 1. Any KINETICA_GEOMETRY_TYPES column → wkb (default) OR wkt (when preferWktOverWkb).
  //    `preferWktOverWkb: true` is used by Phase 28 MapConfigPanel spatial-filter targets
  //    where WKB is deferred (TD-V14-WKB-SPIKE) and produces an unusable "Incomplete" row.
  //    LayersModal (Phase 11/12 WMS rendering) keeps the default WKB preference because
  //    WMS rendering on geometry columns has always worked in either mode.
  const hasGeometry = columns.some((c) =>
    KINETICA_GEOMETRY_TYPES.has(normalizeType(c.type))
  );
  if (hasGeometry) return preferWkt ? "wkt" : "wkb";

  // 2. Any column with type containing "wkt" → wkt
  const hasWktHint = columns.some((c) =>
    c.type.toLowerCase().includes("wkt")
  );
  if (hasWktHint) return "wkt";

  // 3. Track column shape: TRACKID + x + y + TIMESTAMP all present (case-insensitive).
  //    Must come BEFORE the lat/lon name heuristic because track tables have x/y columns
  //    that would otherwise match the latlon name pattern (research §Pattern 3).
  if (isTrackTable(columns)) return "track";

  // 4. Both lat-name + lon-name columns present → latlon
  const hasLat = columns.some((c) => /^(lat|latitude|y)$/i.test(c.name));
  const hasLon = columns.some((c) => /^(lon|lng|longitude|x)$/i.test(c.name));
  if (hasLat && hasLon) return "latlon";

  // 5. Fallback
  return "latlon";
}
