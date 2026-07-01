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
import { useFilterCombinationStore } from "../../store/filterCombinationStore";
import { NOFILTER_SENTINEL } from "../../lib/stableComboHash";
import { useDashboardContext } from "../DashboardContext";
import {
  pickNumericBinWidth,
  buildNumericRangeQuery,
  formatNumericTick,
  DEFAULT_MAX_BUCKETS,
  type NumericMetric,
} from "../../lib/numericBin";
import { buildNumericLineSql } from "../../lib/buildNumericLineSql";
import { andCustomWhere } from "../../lib/customWhere";
import { MAX_SERIES, selectTopSeries, pivotSeriesRows } from "../../lib/groupedSeries";
import { useChartAxisColors } from "../../lib/chartColors";
import { getCbColorTheme, themeColorsFor } from "../../lib/cbColorThemes";
import { RECHARTS_TOOLTIP_PROPS } from "../../lib/chartTheme";
import { DEFAULT_COLOR_THEME, MAX_METRICS } from "./TimelineConfigPanel";
import type { NumericLineConfig } from "./NumericLineConfigPanel";
// Phase 77 Plan 02 (COLAPPLY-V115-02): column label + value formatting at tooltip.
import { useColumnDisplayConfigStore } from "../../store/columnDisplayConfigStore";
import { resolveFormatter } from "../../store/columnDisplayConfigStore";
import { ColumnFormatTooltip } from "./ColumnFormatTooltip";
// Phase 86 (AXIS-V117-02/03): Y-axis tick formatter — per-widget override OR bound column default.
import { buildFormatter } from "../../lib/columnFormatter";
import { estimateValueAxisWidth } from "../../lib/estimateAxisWidth";
// Phase 100 (METRIC-V119-01/03): custom metric store for configVersion re-fetch + loadConfig.
import { useCustomMetricsStore } from "../../store/customMetricsStore";
// Phase 101 (YAXIS-V119-01/02/03/04): Y-axis scale mode — absent → {} → byte-identical.
import { yAxisScaleProps } from "../../lib/yAxisScale";

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
  const groupByColumn = cfg.groupByColumn ?? "";
  const grouped = groupByColumn !== "";
  const rawMetrics = (cfg.metrics ?? []) as NumericMetric[];
  const maxBuckets = cfg.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  const showLegend = cfg.showLegend ?? true;
  const showTooltip = cfg.showTooltip ?? true;
  const vertical = cfg.vertical ?? false;
  const colorTheme = cfg.colorTheme ?? DEFAULT_COLOR_THEME;
  const customWhere = cfg.customWhere ?? "";
  const yAxisScale = cfg.yAxisScale;

  // Defensive: hard-cap to MAX_METRICS even if config persisted more. When grouped,
  // the chart uses a SINGLE metric (metrics[0]) split into one series per group value.
  const metrics = useMemo(() => {
    const capped = rawMetrics.slice(0, grouped ? 1 : MAX_METRICS);
    return capped.map((m, i) => ({ ...m, color: ensureColor(m, i) }));
  }, [rawMetrics, grouped]);

  const { dashboardId } = useDashboardContext();

  // Phase 77 Plan 02 (COLAPPLY-V115-02): configVersion subscription forces re-render on label/format edit.
  // Hooks must be called unconditionally (before early returns) — guard tableId inside effect.
  const configVersion = useColumnDisplayConfigStore((s) => s.configVersion);
  void configVersion; // referenced to prevent tree-shaking; reactive via subscription
  const { loadConfig } = useColumnDisplayConfigStore.getState();
  useEffect(() => {
    if (tableId !== undefined) loadConfig(tableId);
  }, [tableId, loadConfig]);

  // Phase 100 (METRIC-V119-01/03): subscribe to custom metrics configVersion so an edited
  // expression triggers re-fetch. Also load custom metrics on mount / table change.
  const customMetricsConfigVersion = useCustomMetricsStore((s) => s.configVersion);
  useEffect(() => {
    if (tableId !== undefined) {
      useCustomMetricsStore.getState().loadConfig(tableId).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);
  // metricColumn for tooltip: first metric's source column (single-metric / grouped case).
  const metricColumn = metrics[0]?.column ?? "";

  // Phase 86 (AXIS-V117-02/03): Y-axis tick formatter — per-widget override OR bound column default.
  // configVersion dep ensures the column-default refreshes when the column's display config is edited.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const yAxisTickFormatter = useMemo(() => {
    if (cfg.yAxisFormat) {
      const fmt = buildFormatter(cfg.yAxisFormat);
      return (v: unknown) => String(fmt(v) ?? v);
    }
    if (tableId !== undefined && metricColumn !== "") {
      const fmt = resolveFormatter(tableId, metricColumn);
      return (v: unknown) => String(fmt(v) ?? v);
    }
    return (v: unknown) => String(v ?? "");
  }, [cfg.yAxisFormat, tableId, metricColumn, configVersion]);

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
  // Phase 91 (READ-V118-01): table-bound read flips from filterViewStore.views[tableId]
  // to filterCombinationStore (orchestrator-owned combo registry). dv path unchanged
  // (the fetch effect already gates fvViewName behind dynamicViewId === undefined).
  // PITFALL S-02 lock: primitive selectors scoped to this widget's vizKey — never the registry object.
  // undefined hash (orchestrator not yet run) or NOFILTER hash → "" viewName → base table.
  const vizKey = `w:${widget.id}`;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvViewName = useFilterCombinationStore((s) => {
    const h = s.vizToHash[vizKey];
    return h && !h.endsWith(`:${NOFILTER_SENTINEL}`) ? (s.registry[h]?.viewName ?? "") : "";
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvExpiresAt = useFilterCombinationStore((s) => {
    const h = s.vizToHash[vizKey];
    return h && !h.endsWith(`:${NOFILTER_SENTINEL}`) ? (s.registry[h]?.expiresAt ?? 0) : 0;
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fvMaterializing = useFilterCombinationStore((s) => {
    const h = s.vizToHash[vizKey];
    return h && !h.endsWith(`:${NOFILTER_SENTINEL}`) ? (s.registry[h]?.materializing ?? false) : false;
  });
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
  // Phase 72 grouped state: ordered series values + top-N truncation affordance.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [seriesValues, setSeriesValues] = useState<string[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [seriesInfo, setSeriesInfo] = useState<{ truncated: boolean; total: number }>({ truncated: false, total: 0 });

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!effectiveTable || !xField || metrics.length === 0) return;

    // FROM target: query the materialized filter-view (unprefixed → empty schema) when one
    // is active, so the chart re-bins on the filtered range. Filter-view path only.
    const filterView = dynamicViewId === undefined ? fvViewName : undefined;
    if (dynamicViewId === undefined) {
      if (fvMaterializing) return; // suspend while the view materializes
      if (fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt) {
        // Phase 91: clear the combo entry; orchestrator re-materializes on its next tick.
        const h = useFilterCombinationStore.getState().vizToHash[vizKey];
        if (h) useFilterCombinationStore.getState().clearEntry(h);
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

        if (grouped) {
          // ===== Grouped path (Phase 72): single metric → one series per group value. =====
          const metric0 = metrics[0];

          // Step 3a: top-N pre-query — rank series by aggregate metric value DESC.
          // Reuse the same aggExpr shape as buildNumericLineSql (COUNT_DISTINCT → COUNT(DISTINCT)).
          const aggSql = metric0.aggregation === "COUNT_DISTINCT"
            ? `COUNT(DISTINCT ${metric0.column})`
            : `${metric0.aggregation}(${metric0.column})`;
          const fromTarget = querySchema === "" ? queryTable : `${querySchema}.${queryTable}`;
          const topSql =
            `SELECT ${groupByColumn} AS series, ${aggSql} AS value ` +
            `FROM ${fromTarget} ` +
            `WHERE ${xField} IS NOT NULL AND ${groupByColumn} IS NOT NULL${andCustomWhere(customWhere)} ` +
            `GROUP BY series ` +
            `ORDER BY value DESC ` +
            `LIMIT ${MAX_SERIES * 4}`;
          const topRows = decodeSqlResponse(await runSql(topSql, undefined, ctrl.signal));
          const top = selectTopSeries(
            topRows.map((r) => ({ series: String(r.series), value: Number(r.value) })),
          );

          // Step 3b: main grouped query, filtered to the top-N series allow-list.
          const mainSql = buildNumericLineSql({
            schema: querySchema,
            table: queryTable,
            xField,
            binWidth: width,
            metric: metric0,
            maxBuckets,
            groupByColumn,
            seriesIn: top.series,
            customWhere,
            // Phase 100 (METRIC-V119-04): thread tableId so resolveMetricExpr resolves live.
            tableId,
          });
          const groupedRows = decodeSqlResponse(await runSql(mainSql, undefined, ctrl.signal));
          // numericBuckets:true → buckets sort numerically (mirrors the ungrouped Number() sort).
          const pivoted = pivotSeriesRows(
            groupedRows.map((r) => {
              const v = r.value;
              return {
                bucket: String(r.bucket),
                series: String(r.series),
                value: typeof v === "number" && Number.isFinite(v) ? v : null,
              };
            }),
            top.series,
            { numericBuckets: true },
          );

          if (!cancelled) {
            setData(pivoted);
            setSeriesValues(top.series);
            setSeriesInfo({ truncated: top.truncated, total: top.total });
            setBinWidth(width);
            setLoading(false);
          }
          return;
        }

        // ===== Ungrouped path (regression lock): N parallel per-metric queries. =====
        const metricResults = await Promise.all(
          metrics.map((m) => {
            const sql = buildNumericLineSql({
              schema: querySchema,
              table: queryTable,
              xField,
              binWidth: width,
              metric: m,
              maxBuckets,
              customWhere,
              // Phase 100 (METRIC-V119-04): thread tableId so resolveMetricExpr resolves live.
              tableId,
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
          setSeriesValues([]);
          setSeriesInfo({ truncated: false, total: 0 });
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
    // Phase 72: toggling the group-by (or switching the grouped column) must re-fetch.
    groupByColumn, grouped,
    JSON.stringify(metrics.map((m) => `${m.column}:${m.aggregation}:${m.metricId ?? ""}`)),
    filterVersion,
    fvViewName, fvExpiresAt, fvMaterializing,
    // Phase 98: re-fetch when the custom predicate changes.
    customWhere,
    // Phase 100: re-fetch when a custom metric expression is edited.
    customMetricsConfigVersion,
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

  // Phase 72: grouped render reads the ordered top-N series + truncation affordance.
  const top = { series: seriesValues, truncated: seriesInfo.truncated, total: seriesInfo.total };
  // Per-series stroke colors cycle the chart's colorTheme ramp (no raw hex).
  const seriesColors = grouped
    ? themeColorsFor(
        getCbColorTheme(colorTheme) ?? getCbColorTheme(DEFAULT_COLOR_THEME)!,
        Math.max(1, top.series.length),
      )
    : [];

  // Phase 87 (UAT): size the value axis to its formatted tick labels rather than a fixed
  // width, so short SI labels ("18M") reclaim left-edge space for the plot while long raw
  // values ("1,234,567") still fit. recharts 2.x YAxis width is a fixed number (no "auto").
  const yValueKeys = grouped ? top.series : metrics.map((_, i) => `metric_${i}`);
  const numericValues = data.flatMap((row) => yValueKeys.map((k) => Number((row as Record<string, unknown>)[k])));
  const yAxisWidth = estimateValueAxisWidth(numericValues, (v) => yAxisTickFormatter(v));

  // Phase 101 (YAXIS-V119-01/02/03/04): plain call (not a hook) — data is only available here,
  // after early returns; absent mode → {} → no props emitted (YAXIS-V119-04 byte-identical).
  const scaleProps = yAxisScaleProps(yAxisScale, numericValues);

  return (
    <div
      className="widget-timeline"
      data-testid="numericline-renderer"
      data-bin-width={binWidth ?? ""}
      data-vertical={vertical ? "true" : "false"}
      style={{ width: "100%", height: "100%", cursor: "crosshair" }}
    >
      {/* Top-N affordance — surfaces silent series capping (no raw hex; theme token color). */}
      {grouped && top.truncated && (
        <div
          className="config-hint"
          data-testid="numericline-truncated-note"
          style={{ color: "var(--text-muted)", fontSize: 11, padding: "2px 6px" }}
        >
          Showing top {MAX_SERIES} of {top.total} series
        </div>
      )}
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
              width={yAxisWidth}
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

          {/* Value axis/axes. GROUPED (Phase 72): a SINGLE shared value axis — all series
              share the one metric's scale. UNGROUPED: one axis per metric (alternating
              sides). YAxis when horizontal, XAxis when vertical. */}
          {grouped ? (
            vertical ? (
              <XAxis
                key={AXIS_IDS[0]}
                type="number"
                xAxisId={AXIS_IDS[0]}
                orientation="bottom"
                stroke={X_AXIS_COLOR}
                tick={{ fill: X_AXIS_COLOR, fontSize: 11 }}
                tickFormatter={yAxisTickFormatter}
                {...scaleProps}
              />
            ) : (
              <YAxis
                key={AXIS_IDS[0]}
                type="number"
                yAxisId={AXIS_IDS[0]}
                width={yAxisWidth}
                stroke={X_AXIS_COLOR}
                tick={{ fill: X_AXIS_COLOR, fontSize: 11 }}
                tickFormatter={yAxisTickFormatter}
                {...scaleProps}
              />
            )
          ) : (
            metrics.map((m, i) => {
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
                    tickFormatter={yAxisTickFormatter}
                    {...scaleProps}
                  />
                );
              }
              return (
                <YAxis
                  key={AXIS_IDS[i]}
                  type="number"
                  yAxisId={AXIS_IDS[i]}
                  orientation={AXIS_ORIENTATIONS[i]}
                  width={yAxisWidth}
                  stroke={toCssColor(m.color)}
                  tick={tickStyle}
                  tickFormatter={yAxisTickFormatter}
                  {...scaleProps}
                />
              );
            })
          )}

          {grouped
            ? top.series.map((sv, i) => (
                <Line
                  key={`series_${sv}`}
                  {...(vertical ? { xAxisId: AXIS_IDS[0] } : { yAxisId: AXIS_IDS[0] })}
                  dataKey={sv}
                  stroke={toCssColor(seriesColors[i] ?? seriesColors[0] ?? "FF66C2A5")}
                  strokeWidth={2}
                  dot={false}
                  name={sv}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))
            : metrics.map((m, i) => (
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
            <Tooltip
              {...RECHARTS_TOOLTIP_PROPS}
              content={<ColumnFormatTooltip tableId={tableId} groupByColumn={groupByColumn} metricColumn={metricColumn} />}
            />
          )}
          {/* Legend: always shown when grouped (series values matter); when ungrouped,
              only for multi-metric (unchanged). */}
          {((grouped && showLegend) || (!grouped && showLegend && metrics.length > 1)) && (
            <Legend verticalAlign="bottom" />
          )}

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
