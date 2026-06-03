/**
 * Phase 45 Plan 03 (TIMELINE-V17-02, V17-06..V17-11): Timeline Chart widget renderer.
 *
 * Short-circuits BEFORE AggregatedWidgetRenderer in WidgetRenderer.tsx. Owns its full
 * lifecycle:
 *   1. Mount: fetches time range via runSql(buildTimelineRangeQuery) — NOT columnStatsFn
 *      (RESEARCH.md §C-01: columnStatsFn asserts Number.isFinite on parsed values; Kinetica
 *      returns datetime MIN/MAX as strings, so columnStatsFn throws on datetime columns).
 *   2. Calls pickInterval({ rangeMs, maxIntervals }) to choose the bucket interval.
 *   3. Issues N parallel runSql(buildTimelineSql) calls (one per metric); merges results
 *      by bucket into a single Recharts-ready array; missing metric values = null (gaps).
 *   4. Renders multi-axis Recharts LineChart with alternating left/right YAxis per metric
 *      and matching stroke/tick colors.
 *   5. Drag-to-filter via onMouseDown/Move/Up on the LineChart wrapper. Commit on mouse-up:
 *      setBulkFilters([BETWEEN ActiveFilter on timeCol]) + synchronous markMaterializing.
 *      Click-no-drag (start === end) is suppressed.
 *   6. Subscribes to useFilterStore.filters[tableId] for persistent ReferenceArea band
 *      reflecting the applied BETWEEN filter on the timeCol; chip dismissal clears it.
 *
 * SOLE MATERIALIZE TRIGGER INVARIANT (Phase 15 / Phase 30 lock):
 *   This file NEVER imports the materialize function from "../../api/client". Effect 1 in
 *   AggregatedWidgetRenderer fires materialize off the filterVersion tick produced by
 *   setBulkFilters.
 *
 * Mirror DataFilterRenderer's tables-as-prop pattern (DashboardContext does not expose
 * tables; only dashboardId).
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
  pickInterval,
  buildTimelineRangeQuery,
  formatTimelineTick,
  DEFAULT_MAX_INTERVALS,
  type TimelineInterval,
  type TimelineMetric,
} from "../../lib/timelineBin";
import { buildTimelineSql } from "../../lib/buildTimelineSql";
import { useChartAxisColors } from "../../lib/chartColors";
import { getCbColorTheme, themeColorsFor } from "../../lib/cbColorThemes";
import { DEFAULT_COLOR_THEME, MAX_METRICS, type TimelineConfig } from "./TimelineConfigPanel";

type Props = {
  widget: WidgetDto;
  tables: TableDto[];
};

const AXIS_ORIENTATIONS = ["left", "right", "left", "right"] as const;
const AXIS_IDS = ["m0", "m1", "m2", "m3"] as const;
const BAND_COLOR = "#38bdf8";
// GRID_COLOR / X_AXIS_COLOR are theme-aware — resolved per-render via useChartAxisColors().

// "FF66C2A5" → "#66c2a5" for Recharts stroke prop
function toCssColor(aarrggbb: string): string {
  if (aarrggbb.startsWith("#")) return aarrggbb;
  const hex = aarrggbb.length === 8 ? aarrggbb.slice(2) : aarrggbb;
  return "#" + hex.toLowerCase();
}

// Defensive fallback color for misconfigured metrics
function ensureColor(metric: TimelineMetric, idx: number): string {
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

export default function TimelineRenderer({ widget, tables }: Props): JSX.Element {
  const cfg = (widget.config ?? {}) as Partial<TimelineConfig>;
  const tableId = cfg.tableId;
  const tableRef = cfg.tableRef;
  const dynamicViewId = cfg.dynamicViewId;
  const timeCol = cfg.timeCol ?? "";
  const rawMetrics = (cfg.metrics ?? []) as TimelineMetric[];
  const maxIntervals = cfg.maxIntervals ?? DEFAULT_MAX_INTERVALS;
  const showLegend = cfg.showLegend ?? true;
  const showTooltip = cfg.showTooltip ?? true;
  const vertical = cfg.vertical ?? false;
  const dateFormatOverride = cfg.dateFormatOverride ?? "";

  // Defensive: hard-cap to MAX_METRICS even if config persisted more.
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
  if (timeCol === "") {
    return (
      <div className="widget-timeline widget-timeline--empty">
        <div className="config-hint">No time column selected.</div>
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

  // ----- Subscribe to applied BETWEEN filter for timeCol (persistent band) -----
  // PITFALL C-02: scope selector to filters[tableId]; never the whole map.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const tableFilters = useFilterStore((s) => s.filters[tableId] ?? []);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const filterVersion = useFilterStore((s) => s.filterVersion);

  // ----- Subscribe to the materialized filter-view for this table -----
  // Mirrors WidgetRenderer (WidgetRenderer.tsx:305-321). Without this, the timeline
  // always queries the base table and ignores the applied filter. Scope selectors to
  // views[tableId] (PITFALL C-02). fvMaterializing gates the fetch while the view is
  // in flight; fvViewName/fvExpiresAt drive the FROM-swap + proactive expiry.
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
      (af) => af.column === timeCol && af.operator === "between" && Array.isArray(af.value) && af.value.length === 2,
    );
    if (!f) return null;
    const [lo, hi] = f.value as [unknown, unknown];
    return [String(lo), String(hi)];
  }, [tableFilters, timeCol]);

  // ----- Data fetch state -----
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [data, setData] = useState<Record<string, number | string | null>[]>([]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [interval, setIntervalState] = useState<TimelineInterval | null>(null);

  // Fetch on mount + when relevant config / filterVersion changes (re-bin on filter)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!effectiveTable || !timeCol || metrics.length === 0) return;

    // Resolve the FROM target: when a filter-view is materialized for this table,
    // query it instead of the base table (so the timeline re-bins on the filtered
    // range — "zoom-in for free"). Filter-view path only; dv-bound timelines resolve
    // their source separately. We pass the view name straight into the SQL builders
    // as an unprefixed table (NOT a regex FROM-swap): the timeline SQL contains
    // `EXTRACT(EPOCH FROM ...)`, whose "FROM" would be clobbered by a first-FROM swap.
    const filterView = dynamicViewId === undefined ? fvViewName : undefined;
    if (dynamicViewId === undefined) {
      // Suspend gate: don't query base/stale data while the view is materializing.
      if (fvMaterializing) return;
      // Proactive expiry: drop a stale view so the effect re-fires onto the base table.
      if (fvViewName && fvExpiresAt > 0 && Date.now() >= fvExpiresAt) {
        useFilterViewStore.getState().clearView(tableId);
        return;
      }
    }
    // Filter-view is an unprefixed materialized-view name → empty schema.
    const querySchema = filterView ? "" : effectiveSchema;
    const queryTable = filterView ? filterView : effectiveTable;

    const ctrl = new AbortController();
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Step 1: time range probe via runSql(buildTimelineRangeQuery)
        const rangeSql = buildTimelineRangeQuery({
          schema: querySchema,
          table: queryTable,
          timeCol,
        });
        const rangeResp = await runSql(rangeSql, undefined, ctrl.signal);
        const rangeRows = decodeSqlResponse(rangeResp);
        const lo = Number(rangeRows[0]?.lo ?? 0);
        const hi = Number(rangeRows[0]?.hi ?? 0);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
          if (!cancelled) {
            setError("No time range data");
            setLoading(false);
          }
          return;
        }
        const rangeMs = (hi - lo) * 1000; // EXTRACT(EPOCH) → seconds → ms

        // Step 2: pick interval
        const chosen = pickInterval({ rangeMs, maxIntervals });

        // Step 3: N parallel metric queries
        const metricResults = await Promise.all(
          metrics.map((m) => {
            const sql = buildTimelineSql({
              schema: querySchema,
              table: queryTable,
              timeCol,
              metric: m,
              interval: chosen,
              maxIntervals,
            });
            return runSql(sql, undefined, ctrl.signal).then(decodeSqlResponse);
          }),
        );

        // Step 4: merge by bucket; missing values → null (gap)
        const bucketSet = new Set<string>();
        metricResults.forEach((rows) => rows.forEach((r) => bucketSet.add(String(r.bucket))));
        const sortedBuckets = Array.from(bucketSet).sort();
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
          setIntervalState(chosen);
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
    // Re-fetch when config metrics/timeCol change OR when filterVersion bumps (self-narrowing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveSchema, effectiveTable, timeCol, maxIntervals,
    JSON.stringify(metrics.map((m) => `${m.column}:${m.aggregation}`)),
    filterVersion,
    // Re-fetch when the filter-view materializes / changes / expires (FROM-swap target).
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
    // SOLE-TRIGGER INVARIANT — verbatim from DataFilterRenderer.tsx:346-353
    const filter: ActiveFilter = {
      column: timeCol,
      value: [from, to] as [string, string],
      dataType: "datetime",
      operator: "between",
      sourceWidgetId: widget.id,
      addedAt: Date.now(),
    };
    useFilterStore.getState().setBulkFilters(tableId as number, [filter]);
    useFilterViewStore.getState().markMaterializing(tableId as number, dashboardId);
  }

  // ----- Render -----

  // Chart margins are OUTER padding only — each value axis reserves its own width/height,
  // so the margins must NOT also scale with axis count or they become empty gaps (the
  // "wasted space" symptom). Keep them small/fixed.
  const rightCount = metrics.filter((_, i) => AXIS_ORIENTATIONS[i] === "right").length;
  const marginRight = rightCount > 0 ? 4 : 16;
  // Vertical orientation (Recharts layout="vertical"): the bucket axis becomes the
  // (vertical) category YAxis and each metric's value axis becomes a horizontal XAxis.
  const margin = vertical
    ? { top: 10, right: 16, left: 4, bottom: 0 }
    : { top: 10, right: marginRight, left: 4, bottom: 0 };

  if (loading) {
    return <div className="widget-timeline widget-timeline--loading" data-testid="timeline-loading">Loading timeline…</div>;
  }
  if (error) {
    return <div className="widget-timeline widget-timeline--error" data-testid="timeline-error" style={{ color: "#c44" }}>Timeline error: {error}</div>;
  }
  if (data.length === 0) {
    return <div className="widget-timeline widget-timeline--empty"><div className="config-hint">No data for the selected range.</div></div>;
  }

  // Axis tick formatter for the bucket (category) axis — shared by both orientations.
  const bucketFormatter = (v: string) => {
    // Non-empty, non-"auto" override → operator's literal pass-through (raw bucket).
    if (dateFormatOverride !== "" && dateFormatOverride !== "auto") return v;
    // "auto" (default): format at the chosen bin granularity.
    return interval ? formatTimelineTick(v, interval.key) : v;
  };

  return (
    <div
      className="widget-timeline"
      data-testid="timeline-renderer"
      data-interval={interval?.key ?? ""}
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
            if (dragStart && end && dragStart !== end) {
              const [from, to] = dragStart < end ? [dragStart, end] : [end, dragStart];
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
              width={72}
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

          {/* Value axes — one per metric (alternating sides). YAxis when horizontal,
              XAxis when vertical (left→bottom, right→top). */}
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
            <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
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
              data-testid="timeline-applied-band"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
