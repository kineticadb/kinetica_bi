/**
 * NumericLineRenderer — Numeric Line chart widget renderer.
 *
 * The numeric analog of TimelineRenderer. Short-circuits BEFORE AggregatedWidgetRenderer
 * in WidgetRenderer.tsx. Owns its full lifecycle:
 *   1. Mount: probe numeric range via runSql(buildNumericRangeQuery) (MIN/MAX of xField).
 *   2. pickNumericBinWidth({ min, max, maxBuckets }) → "nice" bin width.
 *   3. N parallel runSql(buildNumericLineSql) calls (one per metric); merge by bucket
 *      (sorted NUMERICALLY); missing metric values = null (gaps).
 *   4. Multi-axis Recharts LineChart with alternating left/right YAxis per metric.
 *   5. Drag-to-filter on the X-axis emits a BETWEEN ActiveFilter (dataType "number") on
 *      the xField via setBulkFilters + synchronous markMaterializing.
 *   6. Active-filter consumption: when a filter-view is materialized for this table, queries
 *      target the view (re-binning on the filtered range) instead of the base table.
 *
 * SOLE MATERIALIZE TRIGGER INVARIANT (Phase 15 / Phase 30 lock): NEVER imports the
 * materialize function. Effect 1 in AggregatedWidgetRenderer fires materialize off the
 * filterVersion tick produced by setBulkFilters.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { runSql } from "../../api/client";
import type { TableDto, WidgetDto } from "../../api/client";
import { useFilterStore, type ActiveFilter } from "../../store/filterStore";
import { useFilterViewStore } from "../../store/filterViewStore";
import { useDashboardContext } from "../DashboardContext";
import {
  pickNumericBinWidth,
  buildNumericRangeQuery,
  formatNumericTick,
  DEFAULT_MAX_BUCKETS,
  type NumericMetric,
} from "../../lib/numericBin";
import { buildNumericLineSql } from "../../lib/buildNumericLineSql";
import { useChartAxisColors } from "../../lib/chartColors";
import { getCbColorTheme, themeColorsFor } from "../../lib/cbColorThemes";
import { RECHARTS_TOOLTIP_PROPS } from "../../lib/chartTheme";
import { DEFAULT_COLOR_THEME, MAX_METRICS } from "./TimelineConfigPanel";
import type { NumericLineConfig } from "./NumericLineConfigPanel";

type Props = {
  widget: WidgetDto;
  tables: TableDto[];
};

const AXIS_ORIENTATIONS = ["left", "right", "left", "right"] as const;
const AXIS_IDS = ["m0", "m1", "m2", "m3"] as const;
const BAND_COLOR = "#38bdf8";
// GRID_COLOR / X_AXIS_COLOR are theme-aware — resolved per-render via useChartAxisColors().

function toCssColor(aarrggbb: string): string {
  if (aarrggbb.startsWith("#")) return aarrggbb;
  const hex = aarrggbb.length === 8 ? aarrggbb.slice(2) : aarrggbb;
  return "#" + hex.toLowerCase();
}

function ensureColor(metric: NumericMetric, idx: number): string {
  if (metric.color) return metric.color;
  const theme = getCbColorTheme(DEFAULT_COLOR_THEME);
  if (!theme) return "FF66C2A5";
  return themeColorsFor(theme, idx + 1)[idx] ?? "FF66C2A5";
}

// Decode Kinetica /api/sql encoded response: { column_headers, column_1, column_2, ... }
function decodeSqlResponse(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const headers = p.column_headers as string[] | undefined;
  if (!Array.isArray(headers)) return [];
  const cols: unknown[][] = headers.map((_, i) => (p[`column_${i + 1}`] as unknown[]) ?? []);
  const len = cols[0]?.length ?? 0;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < len; i++) {
    const row: Record<string, unknown> = {};
    headers.forEach((h, j) => { row[h] = cols[j][i]; });
    rows.push(row);
  }
  return rows;
}

export default function NumericLineRenderer({ widget, tables: _tables }: Props): JSX.Element {
  const cfg = (widget.config ?? {}) as Partial<NumericLineConfig>;
  const tableId = cfg.tableId;
  const tableRef = cfg.tableRef;
  const dynamicViewId = cfg.dynamicViewId;
  const xField = cfg.xField ?? "";
  const rawMetrics = (cfg.metrics ?? []) as NumericMetric[];
  const maxBuckets = cfg.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  const showLegend = cfg.showLegend ?? true;
  const showTooltip = cfg.showTooltip ?? true;
  const vertical = cfg.vertical ?? false;

  const metrics = useMemo(
    () => rawMetrics.slice(0, MAX_METRICS).map((m, i) => ({ ...m, color: ensureColor(m, i) })),
    [rawMetrics],
  );

  const { dashboardId } = useDashboardContext();

  // ----- Empty-state gates -----
  if (tableId === undefined || tableRef === undefined) {
    return (
      <div className="widget-timeline widget-timeline--empty">
        <div className="config-hint">Widget not configured. Open config to pick a base table.</div>
      </div>
    );
  }
  if (xField === "") {
    return (
      <div className="widget-timeline widget-timeline--empty">
        <div className="config-hint">No X-axis column selected.</div>
      </div>
    );
  }
  if (metrics.length === 0) {
    return (
      <div className="widget-timeline widget-timeline--empty">
        <div className="config-hint">No metrics configured. Add at least one in config.</div>
      </div>
    );
  }

  // Parse "schema.name" tableRef
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [schemaName, baseTableName] = (tableRef ?? ".").split(".");
  const effectiveSchema = dynamicViewId !== undefined ? "" : (schemaName ?? "");
  const effectiveTable = baseTableName ?? "";

  // ----- Filter subscriptions (PITFALL C-02: scope to filters[tableId]) -----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const tableFilters = useFilterStore((s) => s.filters[tableId] ?? []);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const filterVersion = useFilterStore((s) => s.filterVersion);

  // ----- Materialized filter-view subscriptions (mirrors TimelineRenderer) -----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvViewName = useFilterViewStore((s) => s.views[tableId]?.viewName);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvExpiresAt = useFilterViewStore((s) => s.views[tableId]?.expiresAt ?? 0);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvMaterializing = useFilterViewStore((s) => s.views[tableId]?.materializing ?? false);
  // Theme-aware grid/axis colors (SVG strokes can't read CSS vars).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { grid: GRID_COLOR, axis: X_AXIS_COLOR } = useChartAxisColors();

  const appliedBand: [string, string] | null = useMemo(() => {
    const f = tableFilters.find(
      (af) => af.column === xField && af.operator === "between" && Array.isArray(af.value) && af.value.length === 2,
    );
    if (!f) return null;
    const [lo, hi] = f.value as [unknown, unknown];
    return [String(lo), String(hi)];
  }, [tableFilters, xField]);

  // ----- Data fetch state -----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [data, setData] = useState<Record<string, number | string | null>[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [binWidth, setBinWidth] = useState<number | null>(null);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!effectiveTable || !xField || metrics.length === 0) return;

    // FROM target: query the materialized filter-view (unprefixed → empty schema) when one
    // is active, so the chart re-bins on the filtered range. Filter-view path only.
    const filterView = dynamicViewId === undefined ? fvViewName : undefined;
    if (dynamicViewId === undefined) {
      if (fvMaterializing) return; // suspend while the view materializes
      if (fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt) {
        useFilterViewStore.getState().clearView(tableId);
        return;
      }
    }
    const querySchema = filterView ? "" : effectiveSchema;
    const queryTable = filterView ? filterView : effectiveTable;

    const ctrl = new AbortController();
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Step 1: numeric range probe (MIN/MAX of xField — finite numbers).
        const rangeSql = buildNumericRangeQuery({ schema: querySchema, table: queryTable, xField });
        const rangeResp = await runSql(rangeSql, undefined, ctrl.signal);
        const rangeRows = decodeSqlResponse(rangeResp);
        const lo = Number(rangeRows[0]?.lo ?? NaN);
        const hi = Number(rangeRows[0]?.hi ?? NaN);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
          if (!cancelled) {
            setError("No numeric range data");
            setLoading(false);
          }
          return;
        }

        // Step 2: choose a nice bin width.
        const width = pickNumericBinWidth({ min: lo, max: hi, maxBuckets });

        // Step 3: N parallel metric queries.
        const metricResults = await Promise.all(
          metrics.map((m) => {
            const sql = buildNumericLineSql({
              schema: querySchema,
              table: queryTable,
              xField,
              binWidth: width,
              metric: m,
              maxBuckets,
            });
            return runSql(sql, undefined, ctrl.signal).then(decodeSqlResponse);
          }),
        );

        // Step 4: merge by bucket; buckets sorted NUMERICALLY; missing values → null (gap).
        const bucketSet = new Set<string>();
        metricResults.forEach((rows) => rows.forEach((r) => bucketSet.add(String(r.bucket))));
        const sortedBuckets = Array.from(bucketSet).sort((a, b) => Number(a) - Number(b));
        const merged = sortedBuckets.map((b) => {
          const row: Record<string, number | string | null> = { bucket: b };
          metricResults.forEach((rows, idx) => {
            const found = rows.find((r) => String(r.bucket) === b);
            const v = found?.value;
            row[`metric_${idx}`] = typeof v === "number" && Number.isFinite(v) ? v : null;
          });
          return row;
        });

        if (!cancelled) {
          setData(merged);
          setBinWidth(width);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveSchema, effectiveTable, xField, maxBuckets,
    JSON.stringify(metrics.map((m) => `${m.column}:${m.aggregation}`)),
    filterVersion,
    fvViewName, fvExpiresAt, fvMaterializing,
  ]);

  // ----- Drag state machine -----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [dragStart, setDragStart] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const isDraggingRef = useRef(false);

  function commitFilter(from: string, to: string) {
    const filter: ActiveFilter = {
      column: xField,
      value: [from, to] as [string, string],
      dataType: "number",
      operator: "between",
      sourceWidgetId: widget.id,
      addedAt: Date.now(),
    };
    useFilterStore.getState().setBulkFilters(tableId as number, [filter]);
    useFilterViewStore.getState().markMaterializing(tableId as number, dashboardId);
  }

  // ----- Render -----
  const rightCount = metrics.filter((_, i) => AXIS_ORIENTATIONS[i] === "right").length;
  const marginRight = rightCount > 0 ? 4 : 16;
  // Vertical orientation (Recharts layout="vertical"): bucket axis → vertical category
  // YAxis; each metric's value axis → horizontal XAxis.
  const margin = vertical
    ? { top: 10, right: 16, left: 4, bottom: 0 }
    : { top: 10, right: marginRight, left: 4, bottom: 0 };

  if (loading) {
    return <div className="widget-timeline widget-timeline--loading" data-testid="numericline-loading">Loading chart…</div>;
  }
  if (error) {
    return <div className="widget-timeline widget-timeline--error" data-testid="numericline-error" style={{ color: "var(--danger)" }}>Numeric line error: {error}</div>;
  }
  if (data.length === 0) {
    return <div className="widget-timeline widget-timeline--empty"><div className="config-hint">No data for the selected range.</div></div>;
  }

  const bucketFormatter = (v: string) => (binWidth != null ? formatNumericTick(v, binWidth) : v);

  return (
    <div
      className="widget-timeline"
      data-testid="numericline-renderer"
      data-bin-width={binWidth ?? ""}
      data-vertical={vertical ? "true" : "false"}
      style={{ width: "100%", height: "100%", cursor: "crosshair" }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          layout={vertical ? "vertical" : "horizontal"}
          margin={margin}
          onMouseDown={(state: { activeLabel?: string }) => {
            if (!state?.activeLabel) return;
            setDragStart(state.activeLabel);
            setDragEnd(state.activeLabel);
            isDraggingRef.current = true;
          }}
          onMouseMove={(state: { activeLabel?: string }) => {
            if (!isDraggingRef.current || !state?.activeLabel) return;
            setDragEnd(state.activeLabel);
          }}
          onMouseUp={(state: { activeLabel?: string }) => {
            const end = state?.activeLabel ?? dragEnd;
            isDraggingRef.current = false;
            // Numeric ordering for the BETWEEN bounds (NOT lexical).
            if (dragStart && end && dragStart !== end) {
              const [from, to] = Number(dragStart) <= Number(end) ? [dragStart, end] : [end, dragStart];
              commitFilter(from, to);
            }
            setDragStart(null);
            setDragEnd(null);
          }}
          onMouseLeave={() => {
            isDraggingRef.current = false;
            setDragStart(null);
            setDragEnd(null);
          }}
        >
          {/* Grid lines run perpendicular to the value axis in each orientation. */}
          <CartesianGrid stroke={GRID_COLOR} {...(vertical ? { horizontal: false } : { vertical: false })} />

          {/* Bucket (category) axis: XAxis when horizontal, YAxis when vertical. */}
          {vertical ? (
            <YAxis
              type="category"
              dataKey="bucket"
              stroke={X_AXIS_COLOR}
              tick={{ fontSize: 11, fill: X_AXIS_COLOR }}
              width={64}
              minTickGap={24}
              tickFormatter={bucketFormatter}
            />
          ) : (
            <XAxis
              type="category"
              dataKey="bucket"
              stroke={X_AXIS_COLOR}
              tick={{ fontSize: 11, fill: X_AXIS_COLOR }}
              minTickGap={24}
              tickFormatter={bucketFormatter}
            />
          )}

          {/* Value axes — one per metric. YAxis when horizontal, XAxis when vertical. */}
          {metrics.map((m, i) => {
            const tickStyle = { fill: toCssColor(m.color), fontSize: 11 };
            if (vertical) {
              return (
                <XAxis
                  key={AXIS_IDS[i]}
                  type="number"
                  xAxisId={AXIS_IDS[i]}
                  orientation={AXIS_ORIENTATIONS[i] === "left" ? "bottom" : "top"}
                  stroke={toCssColor(m.color)}
                  tick={tickStyle}
                />
              );
            }
            return (
              <YAxis
                key={AXIS_IDS[i]}
                type="number"
                yAxisId={AXIS_IDS[i]}
                orientation={AXIS_ORIENTATIONS[i]}
                width={60}
                stroke={toCssColor(m.color)}
                tick={tickStyle}
              />
            );
          })}

          {metrics.map((m, i) => (
            <Line
              key={`line_${i}`}
              {...(vertical ? { xAxisId: AXIS_IDS[i] } : { yAxisId: AXIS_IDS[i] })}
              dataKey={`metric_${i}`}
              stroke={toCssColor(m.color)}
              strokeWidth={2}
              dot={false}
              name={m.label && m.label !== "" ? m.label : `${m.aggregation}(${m.column})`}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          {showTooltip && (
            <Tooltip {...RECHARTS_TOOLTIP_PROPS} />
          )}
          {showLegend && metrics.length > 1 && <Legend verticalAlign="bottom" />}

          {/* Transient drag band — spans the bucket axis (x in horizontal, y in vertical). */}
          {dragStart && dragEnd && dragStart !== dragEnd && (
            <ReferenceArea
              {...(vertical
                ? { xAxisId: AXIS_IDS[0], y1: dragStart, y2: dragEnd }
                : { yAxisId: AXIS_IDS[0], x1: dragStart, x2: dragEnd })}
              fill={BAND_COLOR}
              fillOpacity={0.2}
            />
          )}

          {/* Persistent applied band */}
          {appliedBand && (
            <ReferenceArea
              {...(vertical
                ? { xAxisId: AXIS_IDS[0], y1: appliedBand[0], y2: appliedBand[1] }
                : { yAxisId: AXIS_IDS[0], x1: appliedBand[0], x2: appliedBand[1] })}
              fill={BAND_COLOR}
              fillOpacity={0.15}
              data-testid="numericline-applied-band"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
