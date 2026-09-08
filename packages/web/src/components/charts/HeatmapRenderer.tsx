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

  const cols = useMemo(() => resolveHeatmapColumns(config, data), [config, data]);
  const grid = useMemo(
    () => (cols ? buildHeatmapGrid(data, cols.xCol, cols.yCol) : null),
    [data, cols],
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
    const fmt = buildFormatter(config.valueFormat as FormatSpec | null | undefined);
    return (n: number): string => {
      const out = fmt(n);
      return typeof out === "string" ? out : n.toLocaleString();
    };
  }, [config.valueFormat]);

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
  const yGutter = estimateAxisWidth(yValues) + (yAxisLabel ? TITLE_H : 0);
  const availW = (box.w || FALLBACK_W) - yGutter - PAD - (showLegend ? LEGEND_W : 0);
  const plotW = Math.max(xValues.length * MIN_CELL, availW);
  const cellW = plotW / xValues.length;

  // Rotate x labels ONLY when they cannot fit across a cell. Rotating a 3-char
  // category needlessly reserved a tall bottom gutter; horizontal labels need
  // barely more than the font height.
  const widestX = xValues.reduce((m, v) => Math.max(m, estimateLabelWidth(v)), 0);
  const rotateX = widestX > cellW - 4;
  const xGutter =
    (rotateX ? estimateAxisWidth(xValues) : TICK_FONT + TICK_PAD) +
    TICK_PAD +
    (xAxisLabel ? TITLE_H : 0);

  const availH = (box.h || FALLBACK_H) - PAD - xGutter;
  const plotH = Math.max(yValues.length * MIN_CELL, availH);
  const cellH = plotH / yValues.length;
  const svgW = yGutter + plotW + PAD;
  const svgH = PAD + plotH + xGutter;

  const truncated = data.length >= HEATMAP_CELL_LIMIT;

  return (
    <div
      ref={wrapRef}
      data-testid="heatmap-renderer"
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", position: "relative" }}
    >
      {truncated && (
        <div className="config-hint" data-testid="heatmap-truncated">
          Showing the {HEATMAP_CELL_LIMIT.toLocaleString()} highest-value cells — the grid is
          truncated. Narrow the query or pick lower-cardinality axes.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, width: "100%" }}>
        <div style={{ overflow: "auto", flex: 1, minWidth: 0 }}>
          <svg
            width={svgW}
            height={svgH}
            style={{ display: "block", maxWidth: "100%" }}
            role="img"
            aria-label={`Heatmap of ${metricLabel} by ${cols.xCol} and ${cols.yCol}`}
          >
            {/* Y tick labels — first value at the BOTTOM so a numeric axis reads upward */}
            {yValues.map((yv, i) => {
              if (i % yInterval !== 0) return null;
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
                  {yv}
                </text>
              );
            })}

            {/* X tick labels — rotated -90deg, as category names are usually wider than a cell */}
            {xValues.map((xv, i) => {
              if (i % xInterval !== 0) return null;
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
                  {xv}
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
            top: Math.max(0, hover.py - 8),
            transform: "translate(-50%, -100%)",
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
          <div><strong>{cols.xCol}:</strong> {hover.x}</div>
          <div><strong>{cols.yCol}:</strong> {hover.y}</div>
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
