/**
 * Heatmap chart renderer — a 2-dimension × 1-metric matrix of colored cells.
 *
 * Rides the SHARED aggregated contract (like bar/line/pie/table): the widget is
 * `usesAggregation: true` + `requiresGroupBy: true` with a 2-entry
 * `groupByColumns`, so ChartConfigPanel emits
 *   SELECT <xCol>, <yCol>, AGG(metric) AS value FROM ... GROUP BY <xCol>, <yCol>
 * and AggregatedWidgetRenderer owns the fetch, the filter FROM-swap, the
 * dynamic-view binding and the materialize trigger. This component is a pure
 * `data + config -> SVG` renderer with no data lifecycle of its own, which is
 * why the sole-materialize-trigger invariant is untouched.
 *
 * SVG, not canvas: `canvas` is not a dependency, so `getContext("2d")` returns
 * null under jsdom — a canvas implementation would render nothing in tests and
 * could not be verified.
 *
 * NO raw hex — cell/legend colors come from lib/heatmapColorScale (ColorBrewer,
 * where the color IS the data) and all chrome from useChartAxisColors + theme
 * tokens, per the theme-guard contract.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useChartAxisColors } from "../../lib/chartColors";
import { estimateAxisWidth, estimateLabelWidth } from "../../lib/estimateAxisWidth";
import { buildFormatter, type FormatSpec } from "../../lib/columnFormatter";
import {
  useColumnDisplayConfigStore,
  resolveFormatter,
  resolveLabel,
} from "../../store/columnDisplayConfigStore";
import {
  DEFAULT_HEATMAP_COLOR_THEME,
  heatmapStops,
  legendSwatches,
  normalizeValue,
  sampleRamp,
} from "../../lib/heatmapColorScale";
import {
  buildHeatmapGrid,
  cellKey,
  HEATMAP_CELL_LIMIT,
  resolveHeatmapColumns,
  sliceDomain,
  type AxisOrder,
  type NormalizeMode,
} from "../../lib/heatmapGrid";

type Row = Record<string, unknown>;

/** Layout constants — mirror CalendarRenderer's approach of module-level px consts. */
// Gutters are MEASURED from the labels they must hold (see axisMetrics below), not
// fixed: a fixed 78px bottom gutter reserved room for rotated day names and left
// ~78px of dead space under the plot whenever the x labels were short.
const PAD = 8;
const TITLE_H = 14;   // extra gutter when an axis title is set
const TICK_PAD = 6;   // gap between the plot edge and its tick labels
const MIN_CELL = 6;    // below this the grid scrolls rather than becoming unreadable
const LEGEND_W = 54;
const TICK_FONT = 10;
/** Pre-measurement size (also the size every jsdom render uses). */
const FALLBACK_W = 480;
const FALLBACK_H = 320;

const isTruthy = (v: unknown, dflt: boolean): boolean =>
  v === undefined || v === null ? dflt : v !== false;

const HeatmapRenderer = ({
  data,
  config,
}: {
  data: Row[];
  config: Record<string, unknown>;
}) => {
  const { axis, emptyCell } = useChartAxisColors();
  const [hover, setHover] = useState<{ x: string; y: string; value: number; px: number; py: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Measure the widget so the grid fills it and reflows on dashboard resize.
  // Guarded because jsdom does not implement ResizeObserver — an unguarded
  // constructor would throw and take every render-based test down with it.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Phase 77 convention (COLAPPLY-V115-02): subscribing to configVersion re-renders
  // when the operator edits a column's label or format in "Format columns", so the
  // axes pick the change up without a reload.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  void configVersion; // referenced to prevent tree-shaking; reactive via subscription

  const tableId = Number(config.tableId);
  const hasTable = Number.isFinite(tableId);

  const cols = useMemo(() => resolveHeatmapColumns(config, data), [config, data]);

  /**
   * Per-axis tick formatters, from the column's stored display config — the same
   * source the Data Table and the other renderers use. Without this a timestamp
   * axis renders raw epoch/ISO values, ignoring the Date format the operator set.
   */
  const axisFmt = useMemo(() => {
    const identity = (v: unknown): string => String(v);
    if (!cols || !hasTable) return { x: identity, y: identity };
    const wrap = (col: string) => {
      const fmt = resolveFormatter(tableId, col);
      return (v: unknown): string => {
        // Axis keys are String()-coerced by buildHeatmapGrid, so a numeric
        // timestamp arrives as "1700000000000" — which the date formatter reads
        // as an Invalid Date and passes through raw, leaving the operator's Date
        // format visibly unapplied. Hand a wholly-numeric key back as a number.
        const raw =
          typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v;
        const out = fmt(raw);
        return typeof out === "string" ? out : String(out);
      };
    };
    return { x: wrap(cols.xCol), y: wrap(cols.yCol) };
  }, [cols, hasTable, tableId, configVersion]);

  /** A date-formatted column must read chronologically, not in metric order. */
  const axisOrder = useMemo(() => {
    const kindOf = (col: string): AxisOrder =>
      hasTable &&
      useColumnDisplayConfigStore.getState().configs[tableId]?.columns[col]?.format_spec?.kind ===
        "date"
        ? "date"
        : "auto";
    if (!cols) return {};
    return { x: kindOf(cols.xCol), y: kindOf(cols.yCol) };
  }, [cols, hasTable, tableId, configVersion]);

  const grid = useMemo(
    () => (cols ? buildHeatmapGrid(data, cols.xCol, cols.yCol, axisOrder) : null),
    [data, cols, axisOrder],
  );

  const themeId = (config.colorTheme as string) || DEFAULT_HEATMAP_COLOR_THEME;
  const reverse = config.reverseColors === true;
  const stops = useMemo(() => heatmapStops(themeId, reverse), [themeId, reverse]);
  const swatches = useMemo(() => legendSwatches(stops), [stops]);

  const normalizeAcross = ((config.normalizeAcross as string) || "heatmap") as NormalizeMode;
  const sharp = ((config.rendering as string) || "pixelated") === "pixelated";
  const showLegend = isTruthy(config.showLegend, true);
  const showTooltip = isTruthy(config.showTooltip, true);
  const showValues = config.showValues === true; // default OFF: a dense grid has no room
  const xInterval = Math.max(1, Number(config.xScaleInterval) || 1);
  const yInterval = Math.max(1, Number(config.yScaleInterval) || 1);
  const xAxisLabel = (config.xAxisLabel as string) || "";
  const yAxisLabel = (config.yAxisLabel as string) || "";

  const formatValue = useMemo(() => {
    // The widget's own valueFormat wins; absent one, fall back to the METRIC
    // COLUMN's stored format, which is what the field's hint promises
    // ("Defaults to the metric column's format") and previously did not do.
    const spec = config.valueFormat as FormatSpec | null | undefined;
    const metricCol = (config.metricColumn as string) || "";
    const fmt =
      spec
        ? buildFormatter(spec)
        : hasTable && metricCol
          ? resolveFormatter(tableId, metricCol)
          : buildFormatter(spec);
    return (n: number): string => {
      const out = fmt(n);
      return typeof out === "string" ? out : n.toLocaleString();
    };
  }, [config.valueFormat, config.metricColumn, hasTable, tableId, configVersion]);

  /** Operator-facing column names, honouring any Display label. */
  const axisTitles = useMemo(() => {
    if (!cols) return { x: "", y: "" };
    if (!hasTable) return { x: cols.xCol, y: cols.yCol };
    return { x: resolveLabel(tableId, cols.xCol), y: resolveLabel(tableId, cols.yCol) };
  }, [cols, hasTable, tableId, configVersion]);

  const metricLabel = useMemo(() => {
    const agg = (config.aggregation as string) || "";
    const col = (config.metricColumn as string) || "";
    if (agg && col) {
      return agg === "COUNT_DISTINCT" ? `COUNT(DISTINCT ${col})` : `${agg}(${col})`;
    }
    return "value";
  }, [config.aggregation, config.metricColumn]);

  // ---- Empty / unconfigured states (mirror the shared widget-placeholder chrome) ----
  if (!cols) {
    return (
      <div className="widget-placeholder">
        <span>Pick two Group By columns (X then Y) and a Metric to draw a heatmap.</span>
      </div>
    );
  }
  if (!grid || grid.domain === null) {
    return (
      <div className="widget-placeholder">
        <span>No numeric values to plot</span>
      </div>
    );
  }

  const { xValues, yValues, cells, domain } = grid;

  // ---- Geometry ----
  // The plot FILLS the measured container (the reference design is edge-to-edge),
  // and only falls back to scrolling when cells would shrink below MIN_CELL and
  // stop being readable. `box` is 0 until the ResizeObserver fires (and stays 0
  // under jsdom, which has no ResizeObserver), so FALLBACK_* keeps the first paint
  // and every test render sane.
  //
  // Gutter sizing order matters and is deliberately NOT circular: the left gutter
  // and the legend consume WIDTH, which fixes cellW; cellW decides whether x labels
  // rotate; rotation decides the bottom gutter, which consumes HEIGHT only.
  // Gutters measure the FORMATTED labels — a raw epoch (13 chars) and its
  // formatted form ("06/19/2026", 10) reserve different widths.
  const xLabels = xValues.map((v) => axisFmt.x(v));
  const yLabels = yValues.map((v) => axisFmt.y(v));
  const yGutter = estimateAxisWidth(yLabels) + (yAxisLabel ? TITLE_H : 0);
  const availW = (box.w || FALLBACK_W) - yGutter - PAD - (showLegend ? LEGEND_W : 0);
  const plotW = Math.max(xValues.length * MIN_CELL, availW);
  const cellW = plotW / xValues.length;

  // Rotate x labels ONLY when they cannot fit across a cell. Rotating a 3-char
  // category needlessly reserved a tall bottom gutter; horizontal labels need
  // barely more than the font height.
  const widestX = xLabels.reduce((m, v) => Math.max(m, estimateLabelWidth(v)), 0);
  const rotateX = widestX > cellW - 4;
  const xGutter =
    (rotateX ? estimateAxisWidth(xLabels) : TICK_FONT + TICK_PAD) +
    TICK_PAD +
    (xAxisLabel ? TITLE_H : 0);

  const availH = (box.h || FALLBACK_H) - PAD - xGutter;
  const plotH = Math.max(yValues.length * MIN_CELL, availH);
  const cellH = plotH / yValues.length;
  const svgW = yGutter + plotW + PAD;
  const svgH = PAD + plotH + xGutter;

  // Threshold is the limit the QUERY actually used, not the cap. The operator can
  // lower "Result limit" below HEATMAP_CELL_LIMIT, and a grid truncated at 1000
  // must warn just as loudly as one truncated at 5000 — comparing against the
  // constant would leave every lowered limit silently holed, which is precisely
  // what this notice exists to prevent. Clamped to the cap because the panel
  // never emits a larger LIMIT.
  const rawLimit = Number(config.limit);
  const cellLimit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, HEATMAP_CELL_LIMIT)
      : HEATMAP_CELL_LIMIT;
  // Auto-thin the tick labels. Drawing one label per value overlaps them into an
  // unreadable smear as soon as the cell is thinner than the text — a 250-value
  // timestamp axis in a short widget is the case that exposed this. The operator's
  // explicit X/YScale Interval is a FLOOR, never overridden downward, so a chosen
  // "every 6th" is still honoured on a roomy axis.
  const autoStep = (extent: number, count: number, need: number): number =>
    extent > 0 && count > 0 ? Math.max(1, Math.ceil(need / (extent / count))) : 1;
  const xStep = Math.max(xInterval, autoStep(plotW, xValues.length, TICK_FONT + 3));
  const yStep = Math.max(yInterval, autoStep(plotH, yValues.length, TICK_FONT + 3));

  const truncated = data.length >= cellLimit;

  /** Estimated tooltip height: 4 lines @ 11px + padding + border, rounded up. */
  const TIP_EST_H = 80;
  /** Room above the hovered cell? Otherwise the tooltip flips below it. */
  const tipAbove = (hover?.py ?? 0) >= TIP_EST_H;

  return (
    <div
      ref={wrapRef}
      data-testid="heatmap-renderer"
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative" }}
    >
      {truncated && (
        <div className="config-hint" data-testid="heatmap-truncated">
          Showing the {cellLimit.toLocaleString()} highest-value cells — the grid is
          truncated. Raise "Result limit", narrow the query, or pick
          lower-cardinality axes.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, width: "100%" }}>
        <div style={{ overflow: "auto", flex: 1, minWidth: 0 }}>
          <svg
            width={svgW}
            height={svgH}
            style={{ display: "block", maxWidth: "100%" }}
            role="img"
            aria-label={`Heatmap of ${metricLabel} by ${axisTitles.x} and ${axisTitles.y}`}
          >
            {/* Y tick labels — first value at the BOTTOM so a numeric axis reads upward */}
            {yValues.map((yv, i) => {
              if (i % yStep !== 0) return null;
              const cy = PAD + (yValues.length - 1 - i) * cellH + cellH / 2;
              return (
                <text
                  key={`yt-${yv}`}
                  x={yGutter - TICK_PAD}
                  y={cy + TICK_FONT / 3}
                  textAnchor="end"
                  fontSize={TICK_FONT}
                  fill={axis}
                >
                  {yLabels[i]}
                </text>
              );
            })}

            {/* X tick labels — rotated -90deg, as category names are usually wider than a cell */}
            {xValues.map((xv, i) => {
              if (i % xStep !== 0) return null;
              const cx = yGutter + i * cellW + cellW / 2;
              const ty = PAD + plotH + TICK_PAD + (rotateX ? 0 : TICK_FONT);
              return (
                <text
                  key={`xt-${xv}`}
                  x={cx}
                  y={ty}
                  textAnchor={rotateX ? "end" : "middle"}
                  fontSize={TICK_FONT}
                  fill={axis}
                  transform={rotateX ? `rotate(-90 ${cx} ${ty})` : undefined}
                >
                  {xLabels[i]}
                </text>
              );
            })}

            {/* Cells */}
            {yValues.map((yv, ri) =>
              xValues.map((xv, ci) => {
                const cell = cells.get(cellKey(xv, yv));
                const x = yGutter + ci * cellW;
                const y = PAD + (yValues.length - 1 - ri) * cellH;
                if (!cell) {
                  return (
                    <rect
                      key={`c-${ci}-${ri}`}
                      x={x}
                      y={y}
                      width={cellW}
                      height={cellH}
                      fill={emptyCell}
                      data-empty="true"
                      style={{ pointerEvents: "none" }}
                    />
                  );
                }
                const [dMin, dMax] = sliceDomain(grid, normalizeAcross, xv, yv) ?? domain;
                const fill = sampleRamp(stops, normalizeValue(cell.value, dMin, dMax));
                return (
                  <rect
                    key={`c-${ci}-${ri}`}
                    x={x}
                    y={y}
                    width={cellW}
                    height={cellH}
                    fill={fill}
                    shapeRendering={sharp ? "crispEdges" : "auto"}
                    onMouseEnter={
                      showTooltip
                        ? () => setHover({ x: xv, y: yv, value: cell.value, px: x + cellW / 2, py: y })
                        : undefined
                    }
                    onMouseLeave={showTooltip ? () => setHover(null) : undefined}
                  />
                );
              }),
            )}

            {/* Optional in-cell values — only legible when cells are large enough */}
            {showValues && cellW >= 28 && cellH >= 14 &&
              yValues.map((yv, ri) =>
                xValues.map((xv, ci) => {
                  const cell = cells.get(cellKey(xv, yv));
                  if (!cell) return null;
                  return (
                    <text
                      key={`v-${ci}-${ri}`}
                      x={yGutter + ci * cellW + cellW / 2}
                      y={PAD + (yValues.length - 1 - ri) * cellH + cellH / 2 + TICK_FONT / 3}
                      textAnchor="middle"
                      fontSize={Math.min(TICK_FONT, cellH - 2)}
                      fill={axis}
                      style={{ pointerEvents: "none" }}
                    >
                      {formatValue(cell.value)}
                    </text>
                  );
                }),
              )}

            {/* Axis titles */}
            {xAxisLabel && (
              <text
                x={yGutter + plotW / 2}
                y={svgH - 2}
                textAnchor="middle"
                fontSize={TICK_FONT + 1}
                fill={axis}
              >
                {xAxisLabel}
              </text>
            )}
            {yAxisLabel && (
              <text
                x={10}
                y={PAD + plotH / 2}
                textAnchor="middle"
                fontSize={TICK_FONT + 1}
                fill={axis}
                transform={`rotate(-90 10 ${PAD + plotH / 2})`}
              >
                {yAxisLabel}
              </text>
            )}
          </svg>
        </div>

        {/* Continuous legend: high at the top, matching the vertical axis direction */}
        {showLegend && (
          <div
            data-testid="heatmap-legend"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: "4px 6px",
              flexShrink: 0,
              width: LEGEND_W,
              alignSelf: "flex-start",
            }}
          >
            <span style={{ fontSize: TICK_FONT, color: axis }}>{formatValue(domain[1])}</span>
            {/* CONTINUOUS gradient, not discrete swatches — the cells are colored
                from a continuous ramp, so a banded legend would misrepresent the
                scale it is explaining. `to top` matches the y axis reading upward. */}
            <div
              data-testid="heatmap-legend-ramp"
              style={{
                width: 12,
                // Height is the PLOT height, not a flex stretch: the ramp explains
                // the grid, so it must align with the grid's vertical extent rather
                // than growing to whatever the widget's flex row happens to be
                // (which pushed the low-end label off-screen).
                height: plotH,
                background: `linear-gradient(to top, ${swatches.join(", ")})`,
              }}
            />
            <span style={{ fontSize: TICK_FONT, color: axis }}>{formatValue(domain[0])}</span>
          </div>
        )}
      </div>

      {/* Tooltip — absolutely positioned over the plot; theme tokens only */}
      {showTooltip && hover && (
        <div
          data-testid="heatmap-tooltip"
          style={{
            position: "absolute",
            // px already includes yGutter (it is measured from the cell's svg x),
            // so it needs no further offset and cannot be negative.
            left: hover.px,
            // Collision flip. The box is painted UPWARD from `top` by the -100%
            // Y translate, so clamping `top` cannot keep it on screen: the clamp
            // constrains the pre-transform origin, not the painted box. A
            // top-row hover (py === PAD) put the whole tooltip above the widget,
            // where the card clipped it and both axis-value lines were lost —
            // found in live UAT, invisible to the old tests because they hover a
            // cell whose overflow does not show.
            //
            // Height is ESTIMATED, not measured: jsdom reports offsetHeight 0,
            // so a measured flip would silently degrade to the broken branch in
            // every test. Over-estimating only flips below when it need not,
            // which is harmless; under-estimating clips, so err high.
            top: tipAbove ? hover.py - 8 : hover.py + cellH + 8,
            transform: tipAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            pointerEvents: "none",
            background: "var(--panel)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 11,
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          <div><strong>{axisTitles.x}:</strong> {axisFmt.x(hover.x)}</div>
          <div><strong>{axisTitles.y}:</strong> {axisFmt.y(hover.y)}</div>
          <div><strong>{metricLabel}:</strong> {formatValue(hover.value)}</div>
          <div>
            <strong>%:</strong>{" "}
            {domain[1] === 0 ? "—" : `${((hover.value / domain[1]) * 100).toFixed(1)}%`}
          </div>
        </div>
      )}
    </div>
  );
};

export default HeatmapRenderer;
