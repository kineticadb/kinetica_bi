/**
 * Pure row-to-grid helpers for HeatmapRenderer.
 *
 * PURE module — zero React/Zustand imports. Mirrors barGroupedSeries.ts, which
 * maps the same multi-column GROUP BY row shape into a chart-ready structure.
 *
 * Input rows come from the SHARED aggregated contract that ChartConfigPanel
 * emits for `groupByColumns` (length 2):
 *   SELECT <xCol>, <yCol>, AGG(metric) AS value FROM ... GROUP BY <xCol>, <yCol>
 * so each row is `{ [xCol]: unknown, [yCol]: unknown, value: number }`.
 */

import { normalizeToMs } from "./columnFormatter";

/**
 * How an axis is ordered.
 *   "auto" — all-numeric sorts numerically, anything else keeps first-seen order
 *   "date" — sorts chronologically, for a column the operator formats as a date
 *
 * "date" is caller-supplied rather than sniffed: guessing would misfire on
 * strings that happen to parse (Date.parse("Monday") is NaN, but plenty of
 * short codes parse to junk), and the renderer already knows the column's
 * configured format kind.
 */
export type AxisOrder = "auto" | "date";

/** Value used to key a cell; String()-coerced so numeric and text axes behave alike. */
export type AxisKey = string;

export type HeatmapCell = {
  x: AxisKey;
  y: AxisKey;
  value: number;
};

export type HeatmapGrid = {
  /** Distinct x values, in render order (left to right). */
  xValues: AxisKey[];
  /** Distinct y values, in render order (bottom to top). */
  yValues: AxisKey[];
  /** Cell lookup keyed by cellKey(x, y). */
  cells: Map<string, HeatmapCell>;
  /** Overall [min,max] across every populated cell; null when none are numeric. */
  domain: [number, number] | null;
};

/**
 * Max cells a heatmap query returns. SHARED CONTRACT: ChartConfigPanel emits this
 * as the SQL LIMIT for heatmap widgets and HeatmapRenderer shows a truncation
 * notice once a result reaches it, so the two must never drift. Lives here (pure
 * lib) rather than in the renderer so the config panel need not import a
 * component module.
 *
 * The shared 100-row default would silently truncate even a 7x24 grid.
 */
export const HEATMAP_CELL_LIMIT = 5000;

/** How the color ramp's domain is computed. Matches the `normalizeAcross` config field. */
export type NormalizeMode = "heatmap" | "x" | "y";

/**
 * Compose a cell key. The separator is NUL, which cannot appear in a SQL scalar,
 * so two distinct (x,y) pairs can never collide the way a printable delimiter
 * allows (compare BAR_SERIES_SEPARATOR's documented " / " collision caveat).
 */
export const cellKey = (x: AxisKey, y: AxisKey): string => `${x}\u0000${y}`;

/**
 * Numeric-aware axis ordering.
 *
 * An axis whose every value parses as a finite number sorts NUMERICALLY —
 * otherwise `hour_of_day` would order 0,1,10,11,...,2 as strings, which is the
 * kind of silently-wrong axis that reads as a data bug. Mixed or textual axes
 * keep first-seen order, so a SQL-side ORDER BY or a naturally meaningful
 * sequence (Monday...Sunday) survives instead of being alphabetized.
 */
/**
 * Epoch-ms for an axis key, for date ordering.
 *
 * Axis keys are String()-coerced (they key cells), so a timestamp column that
 * arrives from SQL as a NUMBER reaches us as "1700000000000" — which
 * normalizeToMs cannot read, because its seconds-vs-ms heuristic only applies to
 * actual numbers and `new Date("1700000000000")` is Invalid Date. Coerce a
 * wholly-numeric key back to a number first.
 *
 * Deliberately NOT fixed inside normalizeToMs: loosening it there would make a
 * year-like string ("2026") parse as epoch seconds (1970) rather than as the
 * date `new Date("2026")` correctly gives.
 */
const axisKeyToMs = (v: AxisKey): number =>
  /^-?\d+(\.\d+)?$/.test(v.trim()) ? normalizeToMs(Number(v)) : normalizeToMs(v);

export function orderAxis(values: AxisKey[], mode: AxisOrder = "auto"): AxisKey[] {
  if (mode === "date") {
    // A date axis read in metric order (the rows arrive ORDER BY value DESC) is
    // the kind of silently-wrong axis a reader takes for a data bug. Values that
    // do not parse sort last, keeping their relative order.
    const withMs = values.map((v, i) => ({ v, i, ms: axisKeyToMs(v) }));
    withMs.sort((a, b) => {
      const aBad = Number.isNaN(a.ms);
      const bBad = Number.isNaN(b.ms);
      if (aBad && bBad) return a.i - b.i;
      if (aBad) return 1;
      if (bBad) return -1;
      return a.ms - b.ms;
    });
    return withMs.map((e) => e.v);
  }
  const allNumeric =
    values.length > 0 && values.every((v) => v !== "" && Number.isFinite(Number(v)));
  if (!allNumeric) return values;
  return [...values].sort((a, b) => Number(a) - Number(b));
}

/**
 * Build the grid from raw SQL rows.
 *
 * - Rows whose `value` is not a finite number are SKIPPED, leaving that cell
 *   unpopulated (rendered as an empty theme-grey cell, never as zero — a
 *   missing combination and a genuine 0 must not look identical).
 * - Duplicate (x,y) pairs keep the LAST row; the GROUP BY makes them unique in
 *   practice, so this only guards a hand-written `sql` in config.
 */
export function buildHeatmapGrid(
  rows: Record<string, unknown>[],
  xCol: string,
  yCol: string,
  order: { x?: AxisOrder; y?: AxisOrder } = {},
): HeatmapGrid {
  const cells = new Map<string, HeatmapCell>();
  const xSeen: AxisKey[] = [];
  const ySeen: AxisKey[] = [];
  const xSet = new Set<AxisKey>();
  const ySet = new Set<AxisKey>();
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    const rawX = row[xCol];
    const rawY = row[yCol];
    if (rawX === undefined || rawY === undefined) continue;
    const raw = row["value"];
    // Reject null/undefined/"" BEFORE coercion: Number(null) and Number("") are
    // both 0, which would turn a SQL NULL into a populated zero cell and make a
    // missing combination indistinguishable from a genuine 0. Mirrors the guard
    // in WidgetRenderer's TableRenderer value scan.
    if (raw === null || raw === undefined || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) continue;

    const x = String(rawX);
    const y = String(rawY);
    if (!xSet.has(x)) { xSet.add(x); xSeen.push(x); }
    if (!ySet.has(y)) { ySet.add(y); ySeen.push(y); }
    cells.set(cellKey(x, y), { x, y, value });
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return {
    xValues: orderAxis(xSeen, order.x ?? "auto"),
    yValues: orderAxis(ySeen, order.y ?? "auto"),
    cells,
    domain: cells.size === 0 ? null : [min, max],
  };
}

/**
 * Resolve the [min,max] a cell's color should be normalized against.
 *
 * - "heatmap" -> the whole grid's domain (one comparable scale everywhere)
 * - "x"       -> only cells sharing the cell's x (per-column contrast)
 * - "y"       -> only cells sharing the cell's y (per-row contrast)
 *
 * Per-axis modes let a faint band stand out when one column or row dwarfs the
 * rest. Returns the grid domain when a slice has no numeric cells.
 */
export function sliceDomain(
  grid: HeatmapGrid,
  mode: NormalizeMode,
  x: AxisKey,
  y: AxisKey,
): [number, number] | null {
  if (mode === "heatmap") return grid.domain;
  const keys = mode === "x"
    ? grid.yValues.map((yv) => cellKey(x, yv))
    : grid.xValues.map((xv) => cellKey(xv, y));
  let min = Infinity;
  let max = -Infinity;
  for (const k of keys) {
    const c = grid.cells.get(k);
    if (!c) continue;
    if (c.value < min) min = c.value;
    if (c.value > max) max = c.value;
  }
  if (min === Infinity) return grid.domain;
  return [min, max];
}

/**
 * Resolve the x/y column names for a heatmap widget's config.
 *
 * Prefers the 2-entry `groupByColumns` array the shared aggregated SQL builder
 * uses. Falls back to inferring from the row shape (every non-`value` column) so
 * a widget carrying only a hand-written `sql` still renders.
 */
export function resolveHeatmapColumns(
  config: Record<string, unknown>,
  rows: Record<string, unknown>[],
): { xCol: string; yCol: string } | null {
  const configured = Array.isArray(config.groupByColumns)
    ? (config.groupByColumns as unknown[]).map(String).filter(Boolean)
    : [];
  const keys = Object.keys(rows[0] ?? {});
  const present = configured.filter((c) => keys.includes(c));
  if (present.length >= 2) return { xCol: present[0], yCol: present[1] };
  const inferred = keys.filter((k) => k !== "value");
  if (inferred.length >= 2) return { xCol: inferred[0], yCol: inferred[1] };
  return null;
}
